// ============================================================
// DROPLET VOICE ENGINE
// Live Transcription Queue
//
// Receives live microphone segments from live-transcriber.js,
// preprocesses them with audio-processor.js, and sends them
// sequentially to the existing Whisper worker.
//
// NOTE: This file is loaded as a CLASSIC script.
// It must NOT contain any top-level `import` statements.
// ============================================================

(function () {

    "use strict";

    window.DropletVoice =
        window.DropletVoice || {};


    // --------------------------------------------------------
    // Internal state
    // --------------------------------------------------------

    let worker = null;

    let modelReady = false;
    let modelLoading = false;
    let activeModel = null;
    let requestedModel = null;

    let queue = [];

    let processing = false;

    let running = false;

    let stopping = false;

    let currentItem = null;

    let jobCounter = 0;

    let transcriptParts = [];

    let sessionStartedAt = null;

    let resolveStop = null;

    let rejectStop = null;


    // --------------------------------------------------------
    // Callbacks
    // --------------------------------------------------------

    let transcriptCallback = null;

    let statusCallback = null;

    let queueCallback = null;

    let errorCallback = null;


    // --------------------------------------------------------
    // Configuration
    // --------------------------------------------------------

    const WORKER_URL =
        "./voice-engine/workers/whisper-worker.js";

    const DEFAULT_MODEL =
        "onnx-community/whisper-base.en";


    // --------------------------------------------------------
    // Helpers
    // --------------------------------------------------------

    function sendStatus(message) {

        console.log(
            "[Droplet Live Queue]",
            message
        );

        if (
            typeof statusCallback ===
            "function"
        ) {

            statusCallback(message);
        }
    }


    function sendQueueState() {

        const state = {

            waiting: queue.length,

            processing,

            currentSegment:
                currentItem
                    ? currentItem.segmentNumber
                    : null,

            running,

            stopping

        };


        console.log(
            "[Droplet Live Queue] State",
            state
        );


        if (
            typeof queueCallback ===
            "function"
        ) {

            queueCallback(state);
        }
    }


    function sendError(error) {

        console.error(
            "[Droplet Live Queue]",
            error
        );


        if (
            typeof errorCallback ===
            "function"
        ) {

            errorCallback(error);
        }
    }


    function getTranscript() {

        return transcriptParts
            .map(part => part.text)
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }


    function emitTranscript() {

        if (
            typeof transcriptCallback !==
            "function"
        ) {

            return;
        }


        transcriptCallback({

            text: getTranscript(),

            parts: transcriptParts.slice(),

            final: (
                stopping &&
                !processing &&
                queue.length === 0
            )

        });
    }


    // --------------------------------------------------------
    // Worker creation
    // --------------------------------------------------------

    function createWorker() {

        if (worker) {

            return worker;
        }


        console.log(
            "[Droplet Live Queue] Creating Whisper worker..."
        );


        worker =
            new Worker(
                WORKER_URL,
                {
                    type: "module"
                }
            );


        worker.onmessage =
            handleWorkerMessage;


        worker.onerror =
            function (event) {

                const error =
                    new Error(
                        event.message ||
                        "Whisper worker error."
                    );


                sendError(error);


                processing = false;

                currentItem = null;


                sendQueueState();


                processNext();
            };


        return worker;
    }


    // --------------------------------------------------------
    // Model loader
    //
    // Ensures the Whisper worker has loaded the model that
    // the queue's next item requires before we hand any audio
    // to it. Handles three cases:
    //
    //   1. Model already ready → continue immediately
    //   2. Same model currently loading → do nothing, wait
    //   3. Different or no model → request load from worker
    // --------------------------------------------------------

    function loadWhisperModel(model) {

        const selectedModel =
            model || DEFAULT_MODEL;


        if (
            modelReady &&
            activeModel === selectedModel
        ) {

            console.log(
                "[Droplet Live Queue] Model already ready:",
                selectedModel
            );

            processNext();

            return;
        }


        if (
            modelLoading &&
            requestedModel === selectedModel
        ) {

            console.log(
                "[Droplet Live Queue] Model already loading:",
                selectedModel
            );

            return;
        }


        const whisperWorker =
            createWorker();


        modelReady = false;

        modelLoading = true;

        requestedModel =
            selectedModel;


        sendStatus(
            "Loading Whisper model..."
        );


        console.log(
            "[Droplet Live Queue] Loading model:",
            selectedModel
        );


        whisperWorker.postMessage({

            type:
                "load-model",

            model:
                selectedModel,

            device:
                "webgpu"

        });
    }


    // --------------------------------------------------------
    // Worker messages
    // --------------------------------------------------------

    function handleWorkerMessage(event) {

        const message =
            event.data || {};


        console.log(
            "[Droplet Live Queue] Worker:",
            message.type,
            message
        );


        if (
            message.type ===
            "status"
        ) {

            if (message.message) {

                sendStatus(
                    message.message
                );
            }

            return;
        }


        if (
            message.type ===
            "model-loading"
        ) {

            sendStatus(
                "Loading Whisper model..."
            );

            return;
        }


        if (
            message.type ===
            "model-ready"
        ) {

            modelReady = true;

            modelLoading = false;

            activeModel =
                requestedModel;

            requestedModel =
                null;


            console.log(
                "[Droplet Live Queue] Whisper model READY:",
                activeModel
            );


            sendStatus(
                "Whisper model ready."
            );


            // Anything captured while the model was loading
            // can now begin transcription.
            processNext();


            return;
        }


        if (
            message.type ===
            "transcription-start"
        ) {

            sendStatus(
                currentItem
                    ? `Transcribing live segment ${currentItem.segmentNumber}...`
                    : "Transcribing live audio..."
            );

            return;
        }


        if (
            message.type ===
            "chunk-start" ||
            message.type ===
            "chunk-complete"
        ) {

            return;
        }


        if (
            message.type ===
            "transcription-complete"
        ) {

            finishCurrentItem(
                message.text || ""
            );

            return;
        }


        if (
            message.type ===
            "transcription-cancelled"
        ) {

            finishCurrentItem(
                ""
            );

            return;
        }


        if (
            message.type ===
            "error"
        ) {

            const error =
                new Error(
                    message.message ||
                    message.error ||
                    "Live Whisper transcription failed."
                );


            failCurrentItem(
                error
            );
        }
    }


    // --------------------------------------------------------
    // Complete current queue item
    // --------------------------------------------------------

    function finishCurrentItem(text) {

        if (!currentItem) {

            console.warn(
                "[Droplet Live Queue] Received completion with no current item."
            );

            return;
        }


        const completed =
            currentItem;


        const cleanedText =
            String(text || "")
                .replace(/\s+/g, " ")
                .trim();


        console.log(
            `[Droplet Live Queue] Segment ${completed.segmentNumber} complete`,
            {
                text: cleanedText
            }
        );


        if (cleanedText) {

            transcriptParts.push({

                segmentNumber:
                    completed.segmentNumber,

                text:
                    cleanedText

            });
        }


        currentItem = null;

        processing = false;


        emitTranscript();

        sendQueueState();


        processNext();
    }


    // --------------------------------------------------------
    // Failed current item
    // --------------------------------------------------------

    function failCurrentItem(error) {

        const failed =
            currentItem;


        sendError(error);


        if (failed) {

            console.error(
                `[Droplet Live Queue] Segment ${failed.segmentNumber} failed.`
            );
        }


        currentItem = null;

        processing = false;


        sendQueueState();


        processNext();
    }


    // --------------------------------------------------------
    // Finish whole live session
    // --------------------------------------------------------

    function finishSessionIfReady() {

        if (
            !stopping ||
            processing ||
            currentItem ||
            queue.length > 0
        ) {

            return false;
        }


        const elapsed =
            sessionStartedAt
                ? (
                    performance.now() -
                    sessionStartedAt
                ) / 1000
                : 0;


        const result = {

            text:
                getTranscript(),

            parts:
                transcriptParts.slice(),

            duration:
                elapsed

        };


        console.log(
            "[Droplet Live Queue] Session complete",
            result
        );


        running = false;

        stopping = false;

        sessionStartedAt = null;


        emitTranscript();

        sendStatus(
            "Live transcription complete."
        );

        sendQueueState();


        if (resolveStop) {

            resolveStop(result);
        }


        resolveStop = null;

        rejectStop = null;


        return true;
    }


    // --------------------------------------------------------
    // Process next queued segment
    //
    // Important: we do NOT remove an item from the queue
    // until Whisper has the required model loaded. This
    // means segments captured during model download are
    // preserved and processed as soon as the model is ready.
    // --------------------------------------------------------

    async function processNext() {

        if (processing) {

            return;
        }


        if (queue.length === 0) {

            finishSessionIfReady();

            return;
        }


        // --------------------------------------------------------
        // Do NOT remove an item from the queue until Whisper
        // is actually ready.
        // --------------------------------------------------------

        const nextItem =
            queue[0];


        const requiredModel =
            nextItem.model ||
            DEFAULT_MODEL;


        if (
            !modelReady ||
            activeModel !== requiredModel
        ) {

            loadWhisperModel(
                requiredModel
            );

            return;
        }


        processing = true;

        currentItem =
            queue.shift();


        sendQueueState();


        try {

            sendStatus(
                `Preparing live segment ${currentItem.segmentNumber}...`
            );


            // Use the SAME audio processor already proven
            // for uploaded and recorded audio.
            const audio =
                await window.DropletVoice
                    .processAudioFile(
                        currentItem.file
                    );


            if (
                !(audio instanceof Float32Array)
            ) {

                throw new Error(
                    "Audio processor did not return Float32Array."
                );
            }


            if (
                audio.length === 0
            ) {

                throw new Error(
                    "Live segment contains no audio samples."
                );
            }


            console.log(
                `[Droplet Live Queue] Segment ${currentItem.segmentNumber} prepared`,
                {
                    samples:
                        audio.length,

                    duration:
                        audio.length /
                        16000
                }
            );


            const jobId =
                "live-" +
                (++jobCounter) +
                "-segment-" +
                currentItem.segmentNumber;


            currentItem.jobId =
                jobId;


            sendStatus(
                `Sending live segment ${currentItem.segmentNumber} to Whisper...`
            );


            const buffer =
                audio.buffer;


            createWorker()
                .postMessage(
                    {

                        type:
                            "transcribe",

                        jobId,

                        audioBuffer:
                            buffer

                    },

                    [
                        buffer
                    ]

                );


        } catch (error) {

            failCurrentItem(
                error
            );
        }
    }


    // --------------------------------------------------------
    // Public: Start queue session
    // --------------------------------------------------------

    window.DropletVoice.startLiveTranscriptionQueue =
        function (options = {}) {

            if (running) {

                throw new Error(
                    "Live transcription queue is already running."
                );
            }


            if (
                typeof window.DropletVoice
                    .processAudioFile !==
                "function"
            ) {

                throw new Error(
                    "Droplet audio processor is not loaded."
                );
            }


            queue = [];

            processing = false;

            currentItem = null;

            transcriptParts = [];

            jobCounter = 0;

            running = true;

            stopping = false;

            sessionStartedAt =
                performance.now();


            modelReady = false;

            modelLoading = false;

            activeModel = null;

            requestedModel = null;


            transcriptCallback =
                options.onTranscript ||
                null;


            statusCallback =
                options.onStatus ||
                null;


            queueCallback =
                options.onQueue ||
                null;


            errorCallback =
                options.onError ||
                null;


            const selectedModel =
                options.model ||
                DEFAULT_MODEL;


            createWorker();


            sendStatus(
                "Live transcription queue started."
            );


            // Start loading immediately instead of waiting
            // for microphone segment 1. The 10 seconds while
            // the user is speaking Segment 1 aren't wasted:
            // Whisper is downloading and initializing in
            // parallel with microphone capture.
            loadWhisperModel(
                selectedModel
            );


            sendQueueState();


            return {

                running: true,

                model:
                    selectedModel

            };
        };


    // --------------------------------------------------------
    // Public: Add live segment
    // --------------------------------------------------------

    window.DropletVoice.enqueueLiveSegment =
        function ({
            file,
            segmentNumber,
            model = DEFAULT_MODEL
        }) {

            if (!running) {

                throw new Error(
                    "Live transcription queue is not running."
                );
            }


            if (stopping) {

                throw new Error(
                    "Live transcription queue is stopping."
                );
            }


            if (!(file instanceof Blob)) {

                throw new Error(
                    "Live queue requires an audio File or Blob."
                );
            }


            queue.push({

                file,

                segmentNumber,

                model,

                queuedAt:
                    performance.now()

            });


            console.log(
                `[Droplet Live Queue] Added segment ${segmentNumber}`,
                {
                    waiting:
                        queue.length
                }
            );


            sendQueueState();


            processNext();


            return queue.length;
        };


    // --------------------------------------------------------
    // Public: Stop after queue drains
    // --------------------------------------------------------

    window.DropletVoice.stopLiveTranscriptionQueue =
        function () {

            if (!running) {

                return Promise.resolve({

                    text:
                        getTranscript(),

                    parts:
                        transcriptParts.slice(),

                    duration:
                        0

                });
            }


            if (stopping) {

                return new Promise(
                    (resolve, reject) => {

                        const previousResolve =
                            resolveStop;


                        const previousReject =
                            rejectStop;


                        resolveStop =
                            function (result) {

                                if (previousResolve) {

                                    previousResolve(
                                        result
                                    );
                                }

                                resolve(
                                    result
                                );
                            };


                        rejectStop =
                            function (error) {

                                if (previousReject) {

                                    previousReject(
                                        error
                                    );
                                }

                                reject(
                                    error
                                );
                            };
                    }
                );
            }


            stopping = true;


            sendStatus(
                queue.length > 0 ||
                processing
                    ? "Microphone stopped. Finishing queued transcription..."
                    : "Finishing live transcription..."
            );


            sendQueueState();


            return new Promise(
                (resolve, reject) => {

                    resolveStop =
                        resolve;

                    rejectStop =
                        reject;


                    if (
                        !processing &&
                        queue.length === 0
                    ) {

                        finishSessionIfReady();
                    }
                }
            );
        };


    // --------------------------------------------------------
    // Public: Read state
    // --------------------------------------------------------

    window.DropletVoice.getLiveTranscriptionQueueState =
        function () {

            return {

                running,

                stopping,

                processing,

                waiting:
                    queue.length,

                currentSegment:
                    currentItem
                        ? currentItem.segmentNumber
                        : null,

                modelReady,

                modelLoading,

                activeModel,

                requestedModel,

                transcript:
                    getTranscript(),

                parts:
                    transcriptParts.slice()

            };
        };


    console.log(
        "[Droplet Live Queue] Engine loaded."
    );

})();
