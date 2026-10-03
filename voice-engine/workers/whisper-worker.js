console.log(
    "DROPLET WHISPER WORKER VERSION: CHUNKED-V2"
);


// ============================================================
// DROPLET VOICE-TO-TEXT
// Whisper Worker - Long Audio Engine
// ============================================================

import {
    pipeline
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";


// ============================================================
// STATE
// ============================================================

let transcriber = null;

let currentModel = null;

let currentDevice = null;

let cancelled = false;

let loadingModel = false;


// Whisper expects 16 kHz audio.
const SAMPLE_RATE = 16000;


// Each chunk sent to Whisper.
const CHUNK_SECONDS = 20;


// Small overlap between chunks.
const OVERLAP_SECONDS = 3;


// ============================================================
// SEND MESSAGE TO PAGE
// ============================================================

function send(type, data = {}) {

    self.postMessage({
        type,
        ...data
    });
}


// ============================================================
// LOAD MODEL
// ============================================================

async function loadModel(
    model = "onnx-community/whisper-base.en",
    device = "webgpu"
) {

    cancelled = false;


    // --------------------------------------------------------
    // SAME MODEL ALREADY LOADED
    // --------------------------------------------------------

    if (
        transcriber &&
        currentModel === model &&
        currentDevice === device
    ) {

        send("model-ready", {
            model,
            device,
            cached: true
        });

        return;
    }


    // --------------------------------------------------------
    // LOAD NEW MODEL
    // --------------------------------------------------------

    loadingModel = true;


    send("status", {
        message: "Loading Whisper model..."
    });


    send("model-loading", {
        model,
        device
    });


    console.log(
        "[Droplet Worker] Loading model:",
        model
    );


    try {

        transcriber = await pipeline(

            "automatic-speech-recognition",

            model,

            {

                device,

                progress_callback: (progress) => {

                    send(
                        "model-progress",
                        {
                            progress
                        }
                    );
                }
            }
        );

    } finally {

        loadingModel = false;
    }


    currentModel = model;

    currentDevice = device;


    console.log(
        "[Droplet Worker] Model ready:",
        model
    );


    send("model-ready", {
        model,
        device,
        cached: false
    });
}


// ============================================================
// CREATE LONG-AUDIO CHUNKS
// ============================================================

function createChunks(audio) {

    const chunkSamples =
        CHUNK_SECONDS *
        SAMPLE_RATE;


    const overlapSamples =
        OVERLAP_SECONDS *
        SAMPLE_RATE;


    const stepSamples =
        chunkSamples -
        overlapSamples;


    const chunks = [];


    let startSample = 0;

    let index = 0;


    while (
        startSample <
        audio.length
    ) {

        const endSample =
            Math.min(
                startSample +
                chunkSamples,

                audio.length
            );


        const chunk =
            audio.slice(
                startSample,
                endSample
            );


        chunks.push({

            index,

            startSample,

            endSample,

            startTime:
                startSample /
                SAMPLE_RATE,

            endTime:
                endSample /
                SAMPLE_RATE,

            audio:
                chunk
        });


        if (
            endSample >=
            audio.length
        ) {

            break;
        }


        startSample +=
            stepSamples;


        index++;
    }


    return chunks;
}


// ============================================================
// CLEAN TRANSCRIPT TEXT
// ============================================================

function cleanText(text) {

    if (!text) {
        return "";
    }


    return text
        .replace(/\s+/g, " ")
        .trim();
}


// ============================================================
// WORD NORMALIZATION
// ============================================================

function normalizeWord(word) {

    return word
        .toLowerCase()
        .replace(
            /[^a-z0-9']/g,
            ""
        );
}


// ============================================================
// MERGE TWO TRANSCRIPTS
// ============================================================

function mergeTranscript(
    previousText,
    newText
) {

    previousText =
        cleanText(
            previousText
        );


    newText =
        cleanText(
            newText
        );


    if (!previousText) {

        return newText;
    }


    if (!newText) {

        return previousText;
    }


    const previousWords =
        previousText.split(/\s+/);


    const newWords =
        newText.split(/\s+/);


    const maxOverlap =
        Math.min(
            30,
            previousWords.length,
            newWords.length
        );


    let bestOverlap = 0;


    for (
        let overlap = maxOverlap;
        overlap >= 1;
        overlap--
    ) {

        let matches = 0;


        for (
            let i = 0;
            i < overlap;
            i++
        ) {

            const previousWord =
                normalizeWord(

                    previousWords[
                        previousWords.length -
                        overlap +
                        i
                    ]
                );


            const newWord =
                normalizeWord(
                    newWords[i]
                );


            if (
                previousWord &&
                newWord &&
                previousWord ===
                    newWord
            ) {

                matches++;
            }
        }


        const matchRatio =
            matches /
            overlap;


        if (
            overlap >= 2 &&
            matchRatio >= 0.75
        ) {

            bestOverlap =
                overlap;

            break;
        }
    }


    if (
        bestOverlap >
        0
    ) {

        const remainingWords =
            newWords.slice(
                bestOverlap
            );


        if (
            remainingWords.length ===
            0
        ) {

            return previousText;
        }


        return cleanText(

            previousText +
            " " +
            remainingWords.join(" ")
        );
    }


    return cleanText(

        previousText +
        " " +
        newText
    );
}


// ============================================================
// TRANSCRIBE LONG AUDIO
// ============================================================

async function transcribeLongAudio(
    audioBuffer,
    jobId
) {

    if (!transcriber) {

        throw new Error(
            "Whisper model has not been loaded."
        );
    }


    cancelled = false;


    const audio =
        new Float32Array(
            audioBuffer
        );


    if (!audio.length) {

        throw new Error(
            "Worker received empty audio."
        );
    }


    const duration =
        audio.length /
        SAMPLE_RATE;


    const chunks =
        createChunks(
            audio
        );


    console.log(
        "[Droplet Worker] Audio duration:",
        duration
    );


    console.log(
        "[Droplet Worker] Chunks:",
        chunks.length
    );


    send(
        "transcription-start",
        {

            jobId,

            duration,

            totalChunks:
                chunks.length,

            chunkSeconds:
                CHUNK_SECONDS,

            overlapSeconds:
                OVERLAP_SECONDS
        }
    );


    const startTime =
        performance.now();


    let fullTranscript = "";


    const completedChunks = [];


    for (
        let i = 0;
        i < chunks.length;
        i++
    ) {

        if (cancelled) {

            send(
                "transcription-cancelled",
                {

                    jobId,

                    text:
                        fullTranscript,

                    completedChunks:
                        completedChunks.length,

                    totalChunks:
                        chunks.length
                }
            );


            return;
        }


        const chunk =
            chunks[i];


        send(
            "chunk-start",
            {

                jobId,

                chunkIndex:
                    i,

                chunkNumber:
                    i + 1,

                totalChunks:
                    chunks.length,

                startTime:
                    chunk.startTime,

                endTime:
                    chunk.endTime
            }
        );


        console.log(
            `[Droplet Worker] Chunk ${i + 1}/${chunks.length}`,
            chunk.startTime,
            "→",
            chunk.endTime
        );


        const chunkStart =
            performance.now();


        const result =
            await transcriber(
                chunk.audio
            );


        const chunkElapsed =
            (
                performance.now() -
                chunkStart
            ) /
            1000;


        const chunkText =
            cleanText(
                result?.text || ""
            );


        fullTranscript =
            mergeTranscript(
                fullTranscript,
                chunkText
            );


        completedChunks.push({

            index:
                i,

            startTime:
                chunk.startTime,

            endTime:
                chunk.endTime,

            text:
                chunkText,

            processingTime:
                chunkElapsed
        });


        const progress =
            (
                (i + 1) /
                chunks.length
            ) *
            100;


        const processedAudio =
            Math.min(
                chunk.endTime,
                duration
            );


        const elapsed =
            (
                performance.now() -
                startTime
            ) /
            1000;


        const averageChunkTime =
            elapsed /
            (i + 1);


        const remainingChunks =
            chunks.length -
            (i + 1);


        const estimatedRemaining =
            averageChunkTime *
            remainingChunks;


        send(
            "chunk-complete",
            {

                jobId,

                chunkIndex:
                    i,

                chunkNumber:
                    i + 1,

                totalChunks:
                    chunks.length,

                chunkText,

                fullText:
                    fullTranscript,

                progress,

                processedAudio,

                duration,

                chunkProcessingTime:
                    chunkElapsed,

                elapsed,

                estimatedRemaining
            }
        );
    }


    const totalElapsed =
        (
            performance.now() -
            startTime
        ) /
        1000;


    send(
        "transcription-complete",
        {

            jobId,

            text:
                fullTranscript,

            duration,

            elapsed:
                totalElapsed,

            totalChunks:
                chunks.length,

            completedChunks
        }
    );
}


// ============================================================
// RECEIVE MESSAGES
// ============================================================

self.onmessage =
    async function(event) {

        const message =
            event.data;


        if (!message) {
            return;
        }


        try {

            // ------------------------------------------------
            // LOAD MODEL
            // ------------------------------------------------

            if (
                message.type ===
                "load-model"
            ) {

                await loadModel(

                    message.model,

                    message.device
                );


                return;
            }


            // ------------------------------------------------
            // TRANSCRIBE
            // ------------------------------------------------

            if (
                message.type ===
                "transcribe"
            ) {

                await transcribeLongAudio(

                    message.audioBuffer,

                    message.jobId
                );


                return;
            }


            // ------------------------------------------------
            // CANCEL
            //
            // IMPORTANT: If we're still downloading the
            // model, ignore the cancel. Otherwise the worker
            // ends up in a zombie state where the model
            // finishes loading but no job ever starts.
            // ------------------------------------------------

            if (
                message.type ===
                "cancel"
            ) {

                if (loadingModel) {

                    send(
                        "status",
                        {
                            message:
                                "Model is still loading. Cancel ignored."
                        }
                    );


                    return;
                }


                cancelled = true;


                send(
                    "status",
                    {
                        message:
                            "Stopping after current chunk..."
                    }
                );


                return;
            }


            // ------------------------------------------------
            // PING
            // ------------------------------------------------

            if (
                message.type ===
                "ping"
            ) {

                send(
                    "pong",
                    {

                        ready:
                            !!transcriber,

                        model:
                            currentModel,

                        device:
                            currentDevice
                    }
                );


                return;
            }


        } catch (error) {

            console.error(
                "[Droplet Worker]",
                error
            );


            send(
                "error",
                {

                    jobId:
                        message.jobId ||
                        null,

                    message:
                        error?.message ||
                        String(error),

                    stack:
                        error?.stack ||
                        null
                }
            );
        }
    };
