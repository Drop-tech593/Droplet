/* ============================================================
   Droplet Voice Engine
   Speaker Transcript Integration
   ------------------------------------------------------------
   Step 4D

   Purpose:
   1. Receive prepared 16 kHz Float32 audio.
   2. Run speaker diarization.
   3. Receive final Speaker 1 / Speaker 2 / ... segments.
   4. Group nearby segments from the same speaker into turns.
   5. Extract each speaker turn from the original audio.
   6. Send each turn to the existing Whisper worker.
   7. Build the final speaker-labelled transcript.

   IMPORTANT:
   - Does NOT modify diarization-worker.js.
   - Does NOT modify whisper-worker.js.
   - Does NOT require word timestamps.
   ============================================================ */

(() => {
    "use strict";

    window.DropletVoice =
        window.DropletVoice || {};

    const SAMPLE_RATE = 16000;

    // Small padding gives Whisper a little context around
    // diarization boundaries without creating large overlaps.
    const TURN_PADDING_BEFORE = 0.15;
    const TURN_PADDING_AFTER = 0.15;

    // Merge neighbouring diarization segments when they belong
    // to the same speaker and the pause is short.
    //
    // This is transcript grouping only.
    // It does NOT change speaker identity.
    const SAME_SPEAKER_MERGE_GAP = 1.10;

    // Extremely tiny pieces are not useful Whisper inputs.
    const MIN_TURN_SECONDS = 0.25;

    const DIARIZATION_WORKER_URL =
        "./voice-engine/workers/diarization-worker.js?v=4D-speaker-transcript";

    const WHISPER_WORKER_URL =
        "./voice-engine/workers/whisper-worker.js?v=4D-speaker-transcript";

    let running = false;

    let cancelled = false;

    let diarizationWorker = null;

    let whisperWorker = null;


    // ============================================================
    // UTILITIES
    // ============================================================

    function emit(callback, payload) {

        if (typeof callback === "function") {

            try {
                callback(payload);
            } catch (error) {
                console.error(
                    "[Speaker Transcript] Callback error:",
                    error
                );
            }
        }
    }


    function cleanText(text) {

        if (typeof text !== "string") {
            return "";
        }

        return text
            .replace(/\s+/g, " ")
            .trim();
    }


    function formatTimestamp(seconds) {

        const safeSeconds =
            Math.max(
                0,
                Number(seconds) || 0
            );

        const total =
            Math.floor(safeSeconds);

        const hours =
            Math.floor(total / 3600);

        const minutes =
            Math.floor(
                (total % 3600) / 60
            );

        const secs =
            total % 60;

        if (hours > 0) {

            return (
                String(hours)
                    .padStart(2, "0") +
                ":" +
                String(minutes)
                    .padStart(2, "0") +
                ":" +
                String(secs)
                    .padStart(2, "0")
            );
        }

        return (
            String(minutes)
                .padStart(2, "0") +
            ":" +
            String(secs)
                .padStart(2, "0")
        );
    }


    function terminateWorkers() {

        if (diarizationWorker) {

            try {
                diarizationWorker.terminate();
            } catch (_) {}

            diarizationWorker = null;
        }

        if (whisperWorker) {

            try {
                whisperWorker.terminate();
            } catch (_) {}

            whisperWorker = null;
        }
    }


    // ============================================================
    // NORMALIZE DIARIZATION SEGMENTS
    // ============================================================

    function normalizeSegments(segments) {

        if (!Array.isArray(segments)) {
            return [];
        }

        return segments
            .map((segment, index) => {

                const start =
                    Number(segment.start);

                const end =
                    Number(segment.end);

                return {

                    index,

                    speaker:
                        segment.speaker ||
                        segment.label ||
                        segment.internalSpeaker ||
                        "Speaker",

                    internalSpeaker:
                        segment.internalSpeaker ||
                        segment.internal ||
                        null,

                    start,

                    end,

                    duration:
                        end - start
                };
            })
            .filter(segment => {

                return (
                    Number.isFinite(
                        segment.start
                    ) &&
                    Number.isFinite(
                        segment.end
                    ) &&
                    segment.end >
                        segment.start
                );
            })
            .sort(
                (a, b) =>
                    a.start - b.start
            );
    }


    // ============================================================
    // BUILD SPEAKER TURNS
    // ============================================================
    //
    // Example:
    //
    // Speaker 1  1.17 → 1.71
    // Speaker 1  2.31 → 5.67
    //
    // becomes:
    //
    // Speaker 1  1.17 → 5.67
    //
    // because the gap is only 0.60 seconds.
    //
    // We do NOT merge across another speaker.
    // ============================================================

    function buildSpeakerTurns(segments) {

        const normalized =
            normalizeSegments(segments);

        if (!normalized.length) {
            return [];
        }

        const turns = [];

        for (
            const segment of normalized
        ) {

            const previous =
                turns[
                    turns.length - 1
                ];

            if (!previous) {

                turns.push({
                    speaker:
                        segment.speaker,

                    internalSpeaker:
                        segment.internalSpeaker,

                    start:
                        segment.start,

                    end:
                        segment.end,

                    sourceSegments: [
                        segment
                    ]
                });

                continue;
            }


            const gap =
                segment.start -
                previous.end;


            const sameSpeaker =
                segment.speaker ===
                previous.speaker;


            const canMerge =
                sameSpeaker &&
                gap >= 0 &&
                gap <=
                    SAME_SPEAKER_MERGE_GAP;


            if (canMerge) {

                previous.end =
                    Math.max(
                        previous.end,
                        segment.end
                    );

                previous.sourceSegments
                    .push(segment);

            } else {

                turns.push({

                    speaker:
                        segment.speaker,

                    internalSpeaker:
                        segment.internalSpeaker,

                    start:
                        segment.start,

                    end:
                        segment.end,

                    sourceSegments: [
                        segment
                    ]
                });
            }
        }


        return turns.map(
            (turn, index) => ({

                ...turn,

                turnIndex:
                    index,

                duration:
                    turn.end -
                    turn.start
            })
        );
    }


    // ============================================================
    // EXTRACT TURN AUDIO
    // ============================================================

    function extractTurnAudio(
        fullAudio,
        turn
    ) {

        const audioDuration =
            fullAudio.length /
            SAMPLE_RATE;


        const paddedStart =
            Math.max(
                0,
                turn.start -
                    TURN_PADDING_BEFORE
            );


        const paddedEnd =
            Math.min(
                audioDuration,
                turn.end +
                    TURN_PADDING_AFTER
            );


        const startSample =
            Math.max(
                0,
                Math.floor(
                    paddedStart *
                    SAMPLE_RATE
                )
            );


        const endSample =
            Math.min(
                fullAudio.length,
                Math.ceil(
                    paddedEnd *
                    SAMPLE_RATE
                )
            );


        if (
            endSample <=
            startSample
        ) {
            return null;
        }


        // slice() creates a new Float32Array,
        // which is important because its buffer
        // will be transferred to Whisper.
        const audio =
            fullAudio.slice(
                startSample,
                endSample
            );


        return {

            audio,

            paddedStart,

            paddedEnd,

            duration:
                audio.length /
                SAMPLE_RATE
        };
    }


    // ============================================================
    // DIARIZATION
    // ============================================================

    function runDiarization(
        audio,
        callbacks
    ) {

        return new Promise(
            (resolve, reject) => {

                let audioSent =
                    false;


                diarizationWorker =
                    new Worker(
                        DIARIZATION_WORKER_URL,
                        {
                            type:
                                "module"
                        }
                    );


                diarizationWorker
                    .onerror =
                    error => {

                        reject(
                            new Error(
                                error.message ||
                                "Diarization worker failed."
                            )
                        );
                    };


                diarizationWorker
                    .onmessage =
                    event => {

                        const data =
                            event.data || {};


                        if (cancelled) {
                            return;
                        }


                        emit(
                            callbacks.onDebug,
                            {
                                engine:
                                    "diarization",

                                data
                            }
                        );


                        if (
                            data.type ===
                            "model-ready"
                        ) {

                            if (audioSent) {
                                return;
                            }

                            audioSent =
                                true;


                            emit(
                                callbacks.onStatus,
                                {
                                    stage:
                                        "diarization",

                                    message:
                                        "Detecting speakers..."
                                }
                            );


                            const copy =
                                new Float32Array(
                                    audio
                                );


                            diarizationWorker
                                .postMessage(
                                    {
                                        type:
                                            "diarize",

                                        audioBuffer:
                                            copy.buffer,

                                        sampleRate:
                                            SAMPLE_RATE
                                    },

                                    [
                                        copy.buffer
                                    ]
                                );


                            return;
                        }


                        if (
                            data.type ===
                            "diarization-complete"
                        ) {

                            resolve(data);

                            return;
                        }


                        if (
                            data.type ===
                            "error"
                        ) {

                            reject(
                                new Error(
                                    data.message ||
                                    data.error ||
                                    "Diarization failed."
                                )
                            );
                        }
                    };


                emit(
                    callbacks.onStatus,
                    {
                        stage:
                            "diarization-model",

                        message:
                            "Loading speaker model..."
                    }
                );


                diarizationWorker
                    .postMessage({
                        type:
                            "load-models",

                        device:
                            "webgpu"
                    });
            }
        );
    }


    // ============================================================
    // LOAD WHISPER
    // ============================================================

    function createWhisperWorker(
        model,
        callbacks
    ) {

        return new Promise(
            (resolve, reject) => {

                whisperWorker =
                    new Worker(
                        WHISPER_WORKER_URL,
                        {
                            type:
                                "module"
                        }
                    );


                whisperWorker
                    .onerror =
                    error => {

                        reject(
                            new Error(
                                error.message ||
                                "Whisper worker failed."
                            )
                        );
                    };


                const readyHandler =
                    event => {

                        const data =
                            event.data || {};


                        emit(
                            callbacks.onDebug,
                            {
                                engine:
                                    "whisper",

                                data
                            }
                        );


                        if (
                            data.type ===
                            "model-ready"
                        ) {

                            whisperWorker
                                .removeEventListener(
                                    "message",
                                    readyHandler
                                );

                            resolve(
                                whisperWorker
                            );

                            return;
                        }


                        if (
                            data.type ===
                            "error"
                        ) {

                            whisperWorker
                                .removeEventListener(
                                    "message",
                                    readyHandler
                                );

                            reject(
                                new Error(
                                    data.message ||
                                    data.error ||
                                    "Whisper model failed to load."
                                )
                            );
                        }
                    };


                whisperWorker
                    .addEventListener(
                        "message",
                        readyHandler
                    );


                emit(
                    callbacks.onStatus,
                    {
                        stage:
                            "whisper-model",

                        message:
                            "Loading Whisper model..."
                    }
                );


                whisperWorker
                    .postMessage({
                        type:
                            "load-model",

                        model:
                            model,

                        device:
                            "webgpu"
                    });
            }
        );
    }


    // ============================================================
    // TRANSCRIBE ONE SPEAKER TURN
    // ============================================================

    function transcribeTurn(
        worker,
        turnAudio,
        jobId,
        callbacks
    ) {

        return new Promise(
            (resolve, reject) => {

                const handler =
                    event => {

                        const data =
                            event.data || {};


                        emit(
                            callbacks.onDebug,
                            {
                                engine:
                                    "whisper",

                                data
                            }
                        );


                        if (
                            data.jobId &&
                            data.jobId !==
                                jobId
                        ) {
                            return;
                        }


                        if (
                            data.type ===
                            "transcription-complete"
                        ) {

                            worker
                                .removeEventListener(
                                    "message",
                                    handler
                                );


                            resolve({
                                text:
                                    cleanText(
                                        data.text
                                    ),

                                raw:
                                    data
                            });

                            return;
                        }


                        if (
                            data.type ===
                            "transcription-cancelled"
                        ) {

                            worker
                                .removeEventListener(
                                    "message",
                                    handler
                                );

                            reject(
                                new Error(
                                    "Transcription cancelled."
                                )
                            );

                            return;
                        }


                        if (
                            data.type ===
                            "error"
                        ) {

                            worker
                                .removeEventListener(
                                    "message",
                                    handler
                                );

                            reject(
                                new Error(
                                    data.message ||
                                    data.error ||
                                    "Turn transcription failed."
                                )
                            );
                        }
                    };


                worker.addEventListener(
                    "message",
                    handler
                );


                const transferable =
                    turnAudio.buffer;


                worker.postMessage(
                    {
                        type:
                            "transcribe",

                        jobId,

                        audioBuffer:
                            transferable
                    },

                    [
                        transferable
                    ]
                );
            }
        );
    }


    // ============================================================
    // BUILD FINAL DISPLAY TRANSCRIPT
    // ============================================================

    function buildDisplayTranscript(
        turns
    ) {

        return turns
            .filter(
                turn =>
                    turn.text &&
                    turn.text.trim()
            )
            .map(turn => {

                return (
                    "[" +
                    formatTimestamp(
                        turn.start
                    ) +
                    "] " +
                    turn.speaker +
                    "\n" +
                    turn.text.trim()
                );
            })
            .join("\n\n");
    }


    // ============================================================
    // MAIN INTEGRATION
    // ============================================================

    async function createSpeakerTranscript(
        audio,
        options = {}
    ) {

        if (running) {

            throw new Error(
                "Speaker transcription is already running."
            );
        }


        if (
            !(audio instanceof Float32Array)
        ) {

            throw new TypeError(
                "Expected 16 kHz Float32Array audio."
            );
        }


        if (!audio.length) {

            throw new Error(
                "Audio is empty."
            );
        }


        running = true;

        cancelled = false;


        const callbacks = {

            onStatus:
                options.onStatus,

            onProgress:
                options.onProgress,

            onTurn:
                options.onTurn,

            onDiarization:
                options.onDiarization,

            onDebug:
                options.onDebug
        };


        const model =
            options.model ||
            "onnx-community/whisper-base.en";


        try {

            // ====================================================
            // STAGE 1 — SPEAKER DIARIZATION
            // ====================================================

            emit(
                callbacks.onStatus,
                {
                    stage:
                        "diarization",

                    message:
                        "Identifying speakers..."
                }
            );


            const diarization =
                await runDiarization(
                    audio,
                    callbacks
                );


            if (cancelled) {

                throw new Error(
                    "Speaker transcription cancelled."
                );
            }


            const segments =
                normalizeSegments(
                    diarization.segments
                );


            if (!segments.length) {

                throw new Error(
                    "No speech segments were detected."
                );
            }


            emit(
                callbacks.onDiarization,
                {
                    numSpeakers:
                        diarization.numSpeakers,

                    speakerLabels:
                        diarization.speakerLabels,

                    segments
                }
            );


            console.log(
                "[Speaker Transcript] Diarization:",
                {
                    numSpeakers:
                        diarization.numSpeakers,

                    segments:
                        segments.length
                }
            );


            // ====================================================
            // STAGE 2 — BUILD SPEAKER TURNS
            // ====================================================

            const turns =
                buildSpeakerTurns(
                    segments
                );


            console.log(
                "[Speaker Transcript] Speaker turns:",
                turns
            );


            if (!turns.length) {

                throw new Error(
                    "No speaker turns could be created."
                );
            }


            // Diarization is finished.
            // Free that worker before Whisper inference.
            if (diarizationWorker) {

                diarizationWorker
                    .terminate();

                diarizationWorker =
                    null;
            }


            // ====================================================
            // STAGE 3 — LOAD WHISPER ONCE
            // ====================================================

            const worker =
                await createWhisperWorker(
                    model,
                    callbacks
                );


            if (cancelled) {

                throw new Error(
                    "Speaker transcription cancelled."
                );
            }


            // ====================================================
            // STAGE 4 — TRANSCRIBE EACH TURN SEQUENTIALLY
            // ====================================================

            const transcriptTurns =
                [];


            for (
                let i = 0;
                i < turns.length;
                i++
            ) {

                if (cancelled) {
                    break;
                }


                const turn =
                    turns[i];


                const extracted =
                    extractTurnAudio(
                        audio,
                        turn
                    );


                if (
                    !extracted ||
                    extracted.duration <
                        MIN_TURN_SECONDS
                ) {

                    console.warn(
                        "[Speaker Transcript] Skipping tiny turn:",
                        turn
                    );

                    continue;
                }


                emit(
                    callbacks.onStatus,
                    {
                        stage:
                            "transcription",

                        message:
                            "Transcribing " +
                            turn.speaker +
                            " (" +
                            (i + 1) +
                            "/" +
                            turns.length +
                            ")",

                        turn:
                            i + 1,

                        totalTurns:
                            turns.length
                    }
                );


                emit(
                    callbacks.onProgress,
                    {
                        completed:
                            i,

                        total:
                            turns.length,

                        percent:
                            Math.round(
                                (
                                    i /
                                    turns.length
                                ) *
                                100
                            )
                    }
                );


                const jobId =
                    "speaker-turn-" +
                    (i + 1) +
                    "-" +
                    Date.now();


                console.log(
                    "[Speaker Transcript]",
                    "Transcribing",
                    turn.speaker,
                    formatTimestamp(
                        turn.start
                    ),
                    "→",
                    formatTimestamp(
                        turn.end
                    )
                );


                const result =
                    await transcribeTurn(
                        worker,
                        extracted.audio,
                        jobId,
                        callbacks
                    );


                const transcriptTurn = {

                    turnIndex:
                        i,

                    speaker:
                        turn.speaker,

                    internalSpeaker:
                        turn.internalSpeaker,

                    start:
                        turn.start,

                    end:
                        turn.end,

                    duration:
                        turn.duration,

                    text:
                        result.text,

                    sourceSegments:
                        turn.sourceSegments
                };


                transcriptTurns.push(
                    transcriptTurn
                );


                emit(
                    callbacks.onTurn,
                    transcriptTurn
                );


                emit(
                    callbacks.onProgress,
                    {
                        completed:
                            i + 1,

                        total:
                            turns.length,

                        percent:
                            Math.round(
                                (
                                    (i + 1) /
                                    turns.length
                                ) *
                                100
                            )
                    }
                );
            }


            if (cancelled) {

                throw new Error(
                    "Speaker transcription cancelled."
                );
            }


            // ====================================================
            // STAGE 5 — FINAL TRANSCRIPT
            // ====================================================

            const text =
                buildDisplayTranscript(
                    transcriptTurns
                );


            const finalResult = {

                type:
                    "speaker-transcript-complete",

                numSpeakers:
                    diarization.numSpeakers,

                speakerLabels:
                    diarization.speakerLabels,

                diarizationSegments:
                    segments,

                turns:
                    transcriptTurns,

                text,

                model
            };


            console.log(
                "========================================"
            );

            console.log(
                "[Droplet] FINAL SPEAKER TRANSCRIPT"
            );

            console.log(
                "Speakers:",
                finalResult.numSpeakers
            );

            console.table(
                transcriptTurns.map(
                    turn => ({
                        speaker:
                            turn.speaker,

                        start:
                            turn.start.toFixed(
                                2
                            ),

                        end:
                            turn.end.toFixed(
                                2
                            ),

                        text:
                            turn.text
                    })
                )
            );

            console.log(text);

            console.log(
                "========================================"
            );


            emit(
                callbacks.onStatus,
                {
                    stage:
                        "complete",

                    message:
                        "Speaker transcript complete."
                }
            );


            return finalResult;


        } finally {

            running = false;

            terminateWorkers();
        }
    }


    // ============================================================
    // CANCEL
    // ============================================================

    function cancelSpeakerTranscript() {

        if (!running) {
            return false;
        }


        cancelled = true;


        if (whisperWorker) {

            try {

                whisperWorker
                    .postMessage({
                        type:
                            "cancel"
                    });

            } catch (_) {}
        }


        terminateWorkers();

        running = false;

        return true;
    }


    // ============================================================
    // PUBLIC API
    // ============================================================

    window.DropletVoice
        .createSpeakerTranscript =
        createSpeakerTranscript;


    window.DropletVoice
        .cancelSpeakerTranscript =
        cancelSpeakerTranscript;


    window.DropletVoice
        .isSpeakerTranscriptRunning =
        function() {
            return running;
        };


    window.DropletVoice
        .buildSpeakerTurns =
        buildSpeakerTurns;


    window.DropletVoice
        .formatSpeakerTimestamp =
        formatTimestamp;


    console.log(
        "[Droplet Voice] speaker-transcript.js ready"
    );

})();
