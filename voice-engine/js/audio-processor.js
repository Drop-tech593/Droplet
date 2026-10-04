console.log(
    "DROPLET WHISPER WORKER VERSION: CHUNKED-V2"
);


// ============================================================
// DROPLET VOICE-TO-TEXT
// Whisper Worker - Long Audio Engine
//
// NOTE: This file is loaded as a CLASSIC worker.
// It must NOT use a top-level `import` statement.
// The Transformers.js library is loaded with dynamic
// import() inside loadModel() instead.
// ============================================================


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


// ============================================================
// CHUNKING (Base / Balanced)
// ============================================================

// Each chunk sent to Whisper.
//
// Whisper is designed around an approximately 30-second
// audio context window. 25 seconds gives us a solid margin
// under that limit while still supplying more surrounding
// speech than the original 20-second configuration.
const CHUNK_SECONDS = 25;


// Small overlap between chunks.
// This helps avoid losing words at boundaries.
const OVERLAP_SECONDS = 3;


// ============================================================
// STEP 14 - SPEECH-AWARE CHUNK BOUNDARIES
// ============================================================

// How far before the normal chunk boundary we search
// for a natural pause.
const BOUNDARY_SEARCH_SECONDS = 3;

// Analyze this much audio at a time while looking for pauses.
const BOUNDARY_FRAME_MS = 50;

// A frame below this RMS level is considered quiet.
const BOUNDARY_SILENCE_RMS = 0.0008;

// Prefer at least this much continuous quiet audio
// before using it as a chunk boundary.
const MIN_BOUNDARY_SILENCE_MS = 250;

// Never allow speech-aware chunks to become too short.
const MIN_CHUNK_SECONDS = 8;


// ============================================================
// STEP 13 - VAD / SILENCE DETECTION
// ============================================================

// Analyze audio in small frames.
const VAD_FRAME_MS = 30;

// A frame must have roughly this RMS energy to count as active.
//
// Your test recording had a very low average amplitude, so this
// deliberately starts conservative. We would rather send some
// silence to Whisper than accidentally remove quiet speech.
const VAD_RMS_THRESHOLD = 0.0010;

// Minimum percentage of active frames required before the
// complete chunk is considered to contain speech.
const VAD_MIN_ACTIVE_RATIO = 0.015;

// Never skip a chunk just because one simple measurement says
// it is silent. Peak amplitude acts as a second safety check.
const VAD_PEAK_THRESHOLD = 0.006;


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

        // ----------------------------------------------------
        // DYNAMIC IMPORT OF TRANSFORMERS.JS
        //
        // This is the key change. A classic worker cannot
        // use `import ... from "..."` at the top of the file,
        // but it CAN use `await import(...)` inside a function.
        // ----------------------------------------------------

        const {
            pipeline
        } = await import(
            "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"
        );


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


    // --------------------------------------------------------
    // STEP 20A - CONFIDENCE CAPABILITY
    //
    // Diagnostic only. We want to know whether the model's
    // generate() function is exposed, and whether the
    // generation_config already declares output_scores or
    // return_dict_in_generate. These are prerequisites for
    // accessing per-token log probabilities from Whisper.
    //
    // We are NOT enabling those options yet. Doing so changes
    // the structure returned by generate() and Whisper
    // pipelines have historically needed special handling
    // around structured generation outputs.
    // --------------------------------------------------------

    console.log(
        "[Droplet Step 20A] Confidence capability",
        {
            modelGenerateAvailable:
                typeof transcriber?.model?.generate === "function",

            generationConfigHasOutputScores:
                Object.prototype.hasOwnProperty.call(
                    transcriber?.model?.generation_config || {},
                    "output_scores"
                ),

            generationConfigHasReturnDict:
                Object.prototype.hasOwnProperty.call(
                    transcriber?.model?.generation_config || {},
                    "return_dict_in_generate"
                ),

            generationConfig: {
                output_scores:
                    transcriber?.model?.generation_config?.output_scores ?? null,

                return_dict_in_generate:
                    transcriber?.model?.generation_config?.return_dict_in_generate ?? null,

                num_beams:
                    transcriber?.model?.generation_config?.num_beams ?? null,

                temperature:
                    transcriber?.model?.generation_config?.temperature ?? null
            }
        }
    );


    send("model-ready", {
        model,
        device,
        cached: false
    });
}


// ============================================================
// CALCULATE RMS OVER A SAMPLE RANGE
// ============================================================

function calculateRms(audio, start, end) {

    let sumSquares = 0;
    let count = 0;

    for (let i = start; i < end; i++) {

        const sample = audio[i];

        sumSquares += sample * sample;

        count++;
    }

    if (count === 0) {
        return 0;
    }

    return Math.sqrt(
        sumSquares / count
    );
}


// ============================================================
// FIND NATURAL PAUSE NEAR CHUNK END
// ============================================================

function findSpeechBoundary(
    audio,
    chunkStartSample,
    targetEndSample
) {

    const searchSamples =
        Math.round(
            BOUNDARY_SEARCH_SECONDS *
            SAMPLE_RATE
        );

    const frameSamples =
        Math.max(
            1,
            Math.round(
                SAMPLE_RATE *
                BOUNDARY_FRAME_MS /
                1000
            )
        );

    const minimumSilenceSamples =
        Math.round(
            SAMPLE_RATE *
            MIN_BOUNDARY_SILENCE_MS /
            1000
        );

    const minimumChunkSamples =
        Math.round(
            MIN_CHUNK_SECONDS *
            SAMPLE_RATE
        );


    // Search only BEFORE the normal chunk boundary.
    const searchStart =
        Math.max(
            chunkStartSample +
                minimumChunkSamples,

            targetEndSample -
                searchSamples
        );


    let silenceStart = null;

    let bestBoundary = null;

    let bestSilenceLength = 0;


    for (
        let frameStart = searchStart;
        frameStart < targetEndSample;
        frameStart += frameSamples
    ) {

        const frameEnd =
            Math.min(
                frameStart +
                    frameSamples,

                targetEndSample
            );


        const rms =
            calculateRms(
                audio,
                frameStart,
                frameEnd
            );


        // --------------------------------------------
        // QUIET FRAME
        // --------------------------------------------

        if (
            rms <
            BOUNDARY_SILENCE_RMS
        ) {

            if (
                silenceStart ===
                null
            ) {

                silenceStart =
                    frameStart;
            }

        } else {

            // ----------------------------------------
            // END OF QUIET REGION
            // ----------------------------------------

            if (
                silenceStart !==
                null
            ) {

                const silenceLength =
                    frameStart -
                    silenceStart;


                if (
                    silenceLength >=
                        minimumSilenceSamples &&
                    silenceLength >
                        bestSilenceLength
                ) {

                    bestSilenceLength =
                        silenceLength;


                    // Cut roughly in the middle
                    // of the pause.

                    bestBoundary =
                        silenceStart +
                        Math.floor(
                            silenceLength /
                            2
                        );
                }


                silenceStart =
                    null;
            }
        }
    }


    // --------------------------------------------
    // SILENCE CONTINUED UNTIL TARGET END
    // --------------------------------------------

    if (
        silenceStart !==
        null
    ) {

        const silenceLength =
            targetEndSample -
            silenceStart;


        if (
            silenceLength >=
                minimumSilenceSamples &&
            silenceLength >
                bestSilenceLength
        ) {

            bestBoundary =
                silenceStart +
                Math.floor(
                    silenceLength /
                    2
                );
        }
    }


    // No useful pause found.
    // Keep original chunk boundary.

    return (
        bestBoundary ||
        targetEndSample
    );
}


// ============================================================
// CREATE SPEECH-AWARE LONG-AUDIO CHUNKS
// ============================================================

function createChunks(audio) {

    const maximumChunkSamples =
        CHUNK_SECONDS *
        SAMPLE_RATE;


    const overlapSamples =
        OVERLAP_SECONDS *
        SAMPLE_RATE;


    const chunks = [];


    let startSample = 0;

    let index = 0;


    while (
        startSample <
        audio.length
    ) {

        const targetEndSample =
            Math.min(
                startSample +
                    maximumChunkSamples,

                audio.length
            );


        let endSample =
            targetEndSample;


        // --------------------------------------------
        // FIND NATURAL SPEECH BOUNDARY
        // --------------------------------------------

        if (
            targetEndSample <
            audio.length
        ) {

            endSample =
                findSpeechBoundary(
                    audio,
                    startSample,
                    targetEndSample
                );
        }


        // Safety protection.

        if (
            endSample <=
            startSample
        ) {

            endSample =
                targetEndSample;
        }


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

            duration:
                (
                    endSample -
                    startSample
                ) /
                SAMPLE_RATE,

            targetEndTime:
                targetEndSample /
                SAMPLE_RATE,

            boundaryAdjusted:
                endSample !==
                targetEndSample,

            audio:
                chunk
        });


        // --------------------------------------------
        // DEBUG INFORMATION
        // --------------------------------------------

        console.log(
            `[Droplet Chunker] Chunk ${index + 1}`,
            {
                start:
                    startSample /
                    SAMPLE_RATE,

                targetEnd:
                    targetEndSample /
                    SAMPLE_RATE,

                actualEnd:
                    endSample /
                    SAMPLE_RATE,

                adjusted:
                    endSample !==
                    targetEndSample
            }
        );


        // Finished.

        if (
            endSample >=
            audio.length
        ) {

            break;
        }


        // --------------------------------------------
        // CREATE OVERLAP
        // --------------------------------------------

        const nextStart =
            Math.max(
                0,
                endSample -
                    overlapSamples
            );


        // Infinite-loop protection.

        if (
            nextStart <=
            startSample
        ) {

            startSample =
                endSample;

        } else {

            startSample =
                nextStart;
        }


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
// STEP 17 - WHISPER HALLUCINATION / REPETITION DETECTOR
// ============================================================

function normalizeRepetitionWord(word) {
    return String(word || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}']/gu, "");
}


function detectRepetitionLoop(text) {

    const words =
        String(text || "")
            .trim()
            .split(/\s+/)
            .map(normalizeRepetitionWord)
            .filter(Boolean);


    if (words.length < 12) {

        return {
            detected: false,
            pattern: null,
            repetitions: 0
        };
    }


    // Check repeating sequences of 1-6 words.
    //
    // Examples:
    //
    // hello hello hello hello
    //
    // one two one two one two
    //
    // thank you very much
    // thank you very much
    // thank you very much

    const MAX_PATTERN_WORDS = 6;


    for (
        let patternLength = 1;
        patternLength <= MAX_PATTERN_WORDS;
        patternLength++
    ) {

        const requiredWords =
            patternLength * 4;


        if (words.length < requiredWords) {
            continue;
        }


        // Look throughout the transcript rather than
        // checking only its beginning.

        for (
            let start = 0;
            start <=
                words.length -
                requiredWords;
            start++
        ) {

            const pattern =
                words.slice(
                    start,
                    start + patternLength
                );


            let repetitions = 1;

            let position =
                start +
                patternLength;


            while (
                position +
                    patternLength <=
                words.length
            ) {

                let matches = true;


                for (
                    let j = 0;
                    j < patternLength;
                    j++
                ) {

                    if (
                        words[position + j] !==
                        pattern[j]
                    ) {

                        matches = false;
                        break;
                    }
                }


                if (!matches) {
                    break;
                }


                repetitions++;

                position +=
                    patternLength;
            }


            // Four consecutive copies is suspicious.
            //
            // But require enough duplicated words too,
            // so ordinary speech such as:
            //
            // "very very very"
            //
            // isn't automatically treated as a failure.

            const repeatedWordCount =
                repetitions *
                patternLength;


            if (
                repetitions >= 4 &&
                repeatedWordCount >= 8
            ) {

                return {
                    detected: true,

                    pattern:
                        pattern.join(" "),

                    repetitions,

                    startWord:
                        start,

                    endWord:
                        position,

                    totalWords:
                        words.length
                };
            }
        }
    }


    return {
        detected: false,
        pattern: null,
        repetitions: 0
    };
}


// ============================================================
// STEP 15 - SMART TRANSCRIPT OVERLAP MERGER
// ============================================================

function normalizeMergeWord(word) {
    return word
        .toLowerCase()
        .replace(/[^\p{L}\p{N}']/gu, "");
}


function wordsAreSimilar(a, b) {

    a = normalizeMergeWord(a);
    b = normalizeMergeWord(b);

    if (!a || !b) {
        return false;
    }

    // Exact match.
    if (a === b) {
        return true;
    }

    // Very small Whisper differences such as:
    // gonna / gona
    // working / workin

    if (
        a.length >= 5 &&
        b.length >= 5
    ) {

        const minimumLength =
            Math.min(
                a.length,
                b.length
            );

        let same = 0;

        for (
            let i = 0;
            i < minimumLength;
            i++
        ) {

            if (a[i] === b[i]) {
                same++;
            }
        }

        if (
            same / Math.max(
                a.length,
                b.length
            ) >= 0.8
        ) {
            return true;
        }
    }

    return false;
}


// ============================================================
// COMPARE TWO POSSIBLE OVERLAP SEQUENCES
// ============================================================

function calculateOverlapSimilarity(
    previousWords,
    newWords,
    previousStart,
    newStart,
    length
) {

    let matches = 0;

    for (
        let i = 0;
        i < length;
        i++
    ) {

        if (
            wordsAreSimilar(
                previousWords[
                    previousStart + i
                ],
                newWords[
                    newStart + i
                ]
            )
        ) {

            matches++;
        }
    }

    return matches / length;
}


// ============================================================
// FIND BEST TRANSCRIPT OVERLAP
// ============================================================

function findBestTranscriptOverlap(
    previousWords,
    newWords
) {

    // We only need to inspect the tail of the previous
    // transcript because the audio overlap is only 3 seconds.

    const MAX_SEARCH_WORDS = 35;

    const previousSearchStart =
        Math.max(
            0,
            previousWords.length -
                MAX_SEARCH_WORDS
        );


    const maxNewWords =
        Math.min(
            newWords.length,
            MAX_SEARCH_WORDS
        );


    let best = {
        found: false,
        score: 0,
        matchedWords: 0,
        previousStart: -1,
        newConsumed: 0
    };


    // --------------------------------------------------------
    // Try different starting positions near the END of the
    // previous transcript.
    //
    // Also allow the new transcript to have 0-3 extra words
    // before the actual matching region.
    // --------------------------------------------------------

    for (
        let previousStart =
            previousSearchStart;

        previousStart <
            previousWords.length;

        previousStart++
    ) {

        for (
            let newStart = 0;
            newStart <= 3 &&
            newStart < maxNewWords;
            newStart++
        ) {

            const availablePrevious =
                previousWords.length -
                previousStart;


            const availableNew =
                newWords.length -
                newStart;


            const compareLength =
                Math.min(
                    availablePrevious,
                    availableNew,
                    20
                );


            // Two words is too easy to match accidentally.
            if (compareLength < 3) {
                continue;
            }


            const score =
                calculateOverlapSimilarity(
                    previousWords,
                    newWords,
                    previousStart,
                    newStart,
                    compareLength
                );


            // Reward longer matches slightly.
            const lengthBonus =
                Math.min(
                    compareLength / 20,
                    1
                ) * 0.08;


            const adjustedScore =
                score +
                lengthBonus;


            if (
                adjustedScore >
                best.score
            ) {

                best = {
                    found: false,
                    score:
                        adjustedScore,
                    rawScore:
                        score,
                    matchedWords:
                        compareLength,
                    previousStart,
                    newStart,

                    // Everything through this point in the
                    // new chunk belongs to the overlap.
                    newConsumed:
                        newStart +
                        compareLength
                };
            }
        }
    }


    // --------------------------------------------------------
    // ACCEPT / REJECT
    // --------------------------------------------------------

    if (
        best.matchedWords >= 3 &&
        best.rawScore >= 0.60
    ) {

        best.found = true;
    }


    return best;
}


// ============================================================
// FALLBACK FUZZY OVERLAP
//
// Handles cases where Whisper inserts/deletes a word.
// Example:
//
// Previous:
// "do that work when I came home"
//
// New:
// "do that when I came home I expected"
//
// Exact positional comparison is imperfect because "work"
// exists only in one version.
// ============================================================

function findFuzzyTranscriptOverlap(
    previousWords,
    newWords
) {

    const previousNormalized =
        previousWords.map(
            normalizeMergeWord
        );

    const newNormalized =
        newWords.map(
            normalizeMergeWord
        );


    const previousStart =
        Math.max(
            0,
            previousWords.length - 30
        );


    const maxNew =
        Math.min(
            newWords.length,
            25
        );


    let best = {
        found: false,
        score: 0,
        previousStart: -1,
        newConsumed: 0,
        matches: 0
    };


    // Try every possible position near the end
    // of the previous transcript.

    for (
        let start = previousStart;
        start < previousWords.length;
        start++
    ) {

        let i = start;
        let j = 0;

        let matches = 0;
        let misses = 0;


        while (
            i < previousWords.length &&
            j < maxNew
        ) {

            if (
                wordsAreSimilar(
                    previousNormalized[i],
                    newNormalized[j]
                )
            ) {

                matches++;

                i++;
                j++;

                continue;
            }


            // --------------------------------------------
            // Try skipping one word from previous text.
            // Handles an extra Whisper word in chunk A.
            // --------------------------------------------

            if (
                i + 1 <
                    previousWords.length &&
                wordsAreSimilar(
                    previousNormalized[i + 1],
                    newNormalized[j]
                )
            ) {

                i += 2;
                j++;

                matches++;
                misses++;

                continue;
            }


            // --------------------------------------------
            // Try skipping one word from new text.
            // Handles an extra Whisper word in chunk B.
            // --------------------------------------------

            if (
                j + 1 <
                    maxNew &&
                wordsAreSimilar(
                    previousNormalized[i],
                    newNormalized[j + 1]
                )
            ) {

                i++;
                j += 2;

                matches++;
                misses++;

                continue;
            }


            misses++;

            i++;
            j++;


            // Too many disagreements means this probably
            // isn't the overlapping section.

            if (misses > 4) {
                break;
            }
        }


        const compared =
            matches +
            misses;


        if (compared < 3) {
            continue;
        }


        const score =
            matches /
            compared;


        if (
            matches >= 3 &&
            score > best.score
        ) {

            best = {
                found:
                    score >= 0.60,

                score,

                previousStart:
                    start,

                newConsumed:
                    j,

                matches
            };
        }
    }


    return best;
}


// ============================================================
// FINAL MERGE FUNCTION
// ============================================================

function mergeTranscript(
    previousText,
    newText
) {

    previousText =
        (previousText || "")
            .trim();

    newText =
        (newText || "")
            .trim();


    if (!previousText) {
        return newText;
    }


    if (!newText) {
        return previousText;
    }


    const previousWords =
        previousText
            .split(/\s+/);


    const newWords =
        newText
            .split(/\s+/);


    // --------------------------------------------------------
    // METHOD 1
    // Normal overlap comparison.
    // --------------------------------------------------------

    const normalOverlap =
        findBestTranscriptOverlap(
            previousWords,
            newWords
        );


    // --------------------------------------------------------
    // METHOD 2
    // Insertion/deletion tolerant comparison.
    // --------------------------------------------------------

    const fuzzyOverlap =
        findFuzzyTranscriptOverlap(
            previousWords,
            newWords
        );


    let overlap = null;


    if (
        normalOverlap.found &&
        fuzzyOverlap.found
    ) {

        overlap =
            normalOverlap.score >=
            fuzzyOverlap.score

                ? normalOverlap
                : fuzzyOverlap;

    } else if (
        normalOverlap.found
    ) {

        overlap =
            normalOverlap;

    } else if (
        fuzzyOverlap.found
    ) {

        overlap =
            fuzzyOverlap;
    }


    // --------------------------------------------------------
    // SUCCESSFUL OVERLAP
    // --------------------------------------------------------

    if (
        overlap &&
        overlap.newConsumed > 0 &&
        overlap.newConsumed <
            newWords.length
    ) {

        const remainingWords =
            newWords.slice(
                overlap.newConsumed
            );


        console.log(
            "[Droplet Merge] Overlap detected",
            {
                score:
                    overlap.score,

                consumedWords:
                    overlap.newConsumed,

                remainingWords:
                    remainingWords.length
            }
        );


        return (
            previousText +
            " " +
            remainingWords.join(" ")
        ).trim();
    }


    // --------------------------------------------------------
    // ENTIRE NEW CHUNK WAS DUPLICATE
    // --------------------------------------------------------

    if (
        overlap &&
        overlap.newConsumed >=
            newWords.length
    ) {

        console.log(
            "[Droplet Merge] Entire new chunk appears duplicated",
            {
                score:
                    overlap.score
            }
        );


        return previousText;
    }


    // --------------------------------------------------------
    // NO RELIABLE OVERLAP
    //
    // Never delete text when we're uncertain.
    // Losing a few duplicated words is much better than
    // deleting something the speaker actually said.
    // --------------------------------------------------------

    console.log(
        "[Droplet Merge] No reliable overlap - preserving text"
    );


    return (
        previousText +
        " " +
        newText
    ).trim();
}


// ============================================================
// STEP 13 - DETECT SPEECH / SILENCE
// ============================================================

function analyzeChunkActivity(audio) {

    const frameSamples =
        Math.max(
            1,
            Math.round(
                SAMPLE_RATE *
                VAD_FRAME_MS /
                1000
            )
        );


    let totalFrames = 0;

    let activeFrames = 0;

    let globalPeak = 0;

    let totalEnergy = 0;

    let totalSamples = 0;


    for (
        let start = 0;
        start < audio.length;
        start += frameSamples
    ) {

        const end =
            Math.min(
                start + frameSamples,
                audio.length
            );


        let sumSquares = 0;

        let framePeak = 0;


        for (
            let i = start;
            i < end;
            i++
        ) {

            const sample =
                audio[i];

            const absolute =
                Math.abs(sample);


            sumSquares +=
                sample * sample;


            if (
                absolute >
                framePeak
            ) {

                framePeak =
                    absolute;
            }


            if (
                absolute >
                globalPeak
            ) {

                globalPeak =
                    absolute;
            }
        }


        const sampleCount =
            end - start;


        if (
            sampleCount <= 0
        ) {

            continue;
        }


        const rms =
            Math.sqrt(
                sumSquares /
                sampleCount
            );


        totalEnergy +=
            sumSquares;

        totalSamples +=
            sampleCount;

        totalFrames++;


        if (
            rms >=
                VAD_RMS_THRESHOLD ||
            framePeak >=
                VAD_PEAK_THRESHOLD
        ) {

            activeFrames++;
        }
    }


    const activeRatio =
        totalFrames > 0
            ? activeFrames /
                totalFrames
            : 0;


    const overallRms =
        totalSamples > 0
            ? Math.sqrt(
                totalEnergy /
                totalSamples
            )
            : 0;


    const hasSpeech =
        activeRatio >=
            VAD_MIN_ACTIVE_RATIO;


    return {

        hasSpeech,

        activeRatio,

        activeFrames,

        totalFrames,

        rms:
            overallRms,

        peak:
            globalPeak
    };
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


    // --------------------------------------------------------
    // BUILD CHUNKS
    // --------------------------------------------------------

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


    // ========================================================
    // PROCESS CHUNKS ONE BY ONE
    // ========================================================

    for (
        let i = 0;
        i < chunks.length;
        i++
    ) {

        // ----------------------------------------------------
        // CANCEL
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // CHUNK START
        // ----------------------------------------------------

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


        // ------------------------------------------------------------
        // STEP 13 - CHECK FOR SPEECH BEFORE RUNNING WHISPER
        // ------------------------------------------------------------

        const activity =
            analyzeChunkActivity(
                chunk.audio
            );


        console.log(
            `[Droplet VAD] Chunk ${i + 1}/${chunks.length}`,
            {
                speech:
                    activity.hasSpeech,

                activeRatio:
                    activity.activeRatio,

                rms:
                    activity.rms,

                peak:
                    activity.peak
            }
        );


        let chunkText = "";

        let skipped = false;


        if (
            activity.hasSpeech
        ) {

            // ------------------------------------------------------------
            // STEP 17 - CONTROLLED WHISPER DECODING
            //
            // Baseline configuration. No generation-time
            // repetition controls. No word timestamps.
            // ------------------------------------------------------------

            const result =
                await transcriber(
                    chunk.audio,
                    {
                        do_sample: false,
                        max_new_tokens: 160,
                        return_timestamps: false
                    }
                );


            // ------------------------------------------------------------
            // STEP 17 - REPETITION DETECTOR (DIAGNOSTIC ONLY)
            // ------------------------------------------------------------

            const repetitionCheck =
                detectRepetitionLoop(
                    result?.text || ""
                );


            if (repetitionCheck.detected) {

                console.warn(
                    "[Droplet Hallucination] Repetition loop detected",
                    repetitionCheck
                );

            }


            chunkText =
                cleanText(
                    result?.text || ""
                );

        } else {

            skipped = true;


            console.log(
                `[Droplet VAD] Skipping silent chunk ${i + 1}`
            );
        }


        const chunkElapsed =
            (
                performance.now() -
                chunkStart
            ) /
            1000;


        // ----------------------------------------------------
        // MERGE
        // ----------------------------------------------------

        fullTranscript =
            mergeTranscript(
                fullTranscript,
                chunkText
            );


        // ----------------------------------------------------
        // SAVE CHUNK INFORMATION
        // ----------------------------------------------------

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
                chunkElapsed,

            skipped,

            vad: {

                hasSpeech:
                    activity.hasSpeech,

                activeRatio:
                    activity.activeRatio,

                rms:
                    activity.rms,

                peak:
                    activity.peak
            }
        });


        // ----------------------------------------------------
        // PROGRESS
        // ----------------------------------------------------

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


        /*
         * Estimate remaining time using
         * average completed-chunk speed.
         */

        const averageChunkTime =
            elapsed /
            (i + 1);


        const remainingChunks =
            chunks.length -
            (i + 1);


        const estimatedRemaining =
            averageChunkTime *
            remainingChunks;


        // ----------------------------------------------------
        // SEND PARTIAL TRANSCRIPT
        // ----------------------------------------------------

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

                skipped,

                vad: {

                    hasSpeech:
                        activity.hasSpeech,

                    activeRatio:
                        activity.activeRatio,

                    rms:
                        activity.rms,

                    peak:
                        activity.peak
                },

                elapsed,

                estimatedRemaining
            }
        );
    }


    // ========================================================
    // FINISHED
    // ========================================================

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
