// ============================================================
// DROPLET VOICE ENGINE
// Live / Near-Live Audio Capture
// ============================================================

(function () {

    "use strict";

    window.DropletVoice =
        window.DropletVoice || {};


    // --------------------------------------------------------
    // Configuration
    // --------------------------------------------------------

    const LIVE_SEGMENT_MS = 10000;


    // --------------------------------------------------------
    // Internal state
    // --------------------------------------------------------

    let stream = null;

    let mediaRecorder = null;

    let segmentChunks = [];

    let segmentTimer = null;

    let liveStartedAt = null;

    let segmentNumber = 0;

    let running = false;

    let stopping = false;


    // Callback supplied by voice-to-text.html.
    let segmentCallback = null;

    let statusCallback = null;


    // --------------------------------------------------------
    // MIME type
    // --------------------------------------------------------

    function chooseMimeType() {

        const types = [

            "audio/webm;codecs=opus",

            "audio/webm",

            "audio/ogg;codecs=opus",

            "audio/ogg"

        ];


        for (const type of types) {

            if (
                MediaRecorder.isTypeSupported(type)
            ) {

                return type;
            }
        }


        return "";
    }


    // --------------------------------------------------------
    // Status helper
    // --------------------------------------------------------

    function sendStatus(message) {

        console.log(
            "[Droplet Live]",
            message
        );


        if (
            typeof statusCallback ===
            "function"
        ) {

            statusCallback(message);
        }
    }


    // --------------------------------------------------------
    // Build one completed audio segment
    // --------------------------------------------------------

    async function buildSegment(
        chunks,
        mimeType
    ) {

        if (
            !chunks ||
            chunks.length === 0
        ) {

            return;
        }


        const blob =
            new Blob(
                chunks,
                {
                    type: mimeType
                }
            );


        if (
            blob.size === 0
        ) {

            return;
        }


        segmentNumber++;


        const extension =
            mimeType.includes("ogg")
                ? "ogg"
                : "webm";


        const file =
            new File(

                [blob],

                "droplet-live-" +
                    segmentNumber +
                    "." +
                    extension,

                {
                    type: mimeType,
                    lastModified:
                        Date.now()
                }

            );


        console.log(
            "[Droplet Live] Segment ready",
            {
                segment:
                    segmentNumber,

                size:
                    file.size,

                type:
                    file.type
            }
        );


        if (
            typeof segmentCallback ===
            "function"
        ) {

            try {

                await segmentCallback({

                    file,

                    segmentNumber,

                    createdAt:
                        performance.now()

                });

            } catch (error) {

                console.error(
                    "[Droplet Live] Segment callback failed:",
                    error
                );
            }
        }
    }


    // --------------------------------------------------------
    // Start a fresh MediaRecorder segment
    // --------------------------------------------------------

    function startSegmentRecorder(
        mimeType
    ) {

        if (
            !stream ||
            !running ||
            stopping
        ) {

            return;
        }


        segmentChunks = [];


        const options = {};


        if (mimeType) {

            options.mimeType =
                mimeType;
        }


        mediaRecorder =
            new MediaRecorder(
                stream,
                options
            );


        mediaRecorder.ondataavailable =
            function (event) {

                if (
                    event.data &&
                    event.data.size > 0
                ) {

                    segmentChunks.push(
                        event.data
                    );
                }
            };


        mediaRecorder.onerror =
            function (event) {

                console.error(
                    "[Droplet Live] MediaRecorder error:",
                    event
                );
            };


        mediaRecorder.onstop =
            async function () {

                const completedChunks =
                    segmentChunks.slice();


                segmentChunks = [];


                await buildSegment(
                    completedChunks,
                    mediaRecorder.mimeType ||
                        mimeType
                );


                // If live mode is still active,
                // immediately begin capturing
                // the next segment.
                if (
                    running &&
                    !stopping
                ) {

                    startSegmentRecorder(
                        mimeType
                    );


                    scheduleSegmentStop(
                        mimeType
                    );
                }
            };


        mediaRecorder.start(1000);


        console.log(
            "[Droplet Live] Capturing segment",
            segmentNumber + 1
        );
    }


    // --------------------------------------------------------
    // Schedule segment boundary
    // --------------------------------------------------------

    function scheduleSegmentStop(
        mimeType
    ) {

        if (segmentTimer) {

            clearTimeout(
                segmentTimer
            );
        }


        segmentTimer =
            setTimeout(
                function () {

                    segmentTimer =
                        null;


                    if (
                        !running ||
                        stopping ||
                        !mediaRecorder
                    ) {

                        return;
                    }


                    if (
                        mediaRecorder.state ===
                        "recording"
                    ) {

                        console.log(
                            "[Droplet Live] Closing segment",
                            segmentNumber + 1
                        );


                        mediaRecorder.stop();
                    }

                },
                LIVE_SEGMENT_MS
            );
    }


    // --------------------------------------------------------
    // Public: start live capture
    // --------------------------------------------------------

    window.DropletVoice.startLiveCapture =
        async function (options = {}) {

            if (running) {

                throw new Error(
                    "Live transcription is already running."
                );
            }


            if (
                !navigator.mediaDevices ||
                !navigator.mediaDevices
                    .getUserMedia ||
                typeof MediaRecorder ===
                    "undefined"
            ) {

                throw new Error(
                    "Live microphone capture is not supported by this browser."
                );
            }


            segmentCallback =
                options.onSegment ||
                null;


            statusCallback =
                options.onStatus ||
                null;


            sendStatus(
                "Requesting microphone..."
            );


            stream =
                await navigator.mediaDevices
                    .getUserMedia({

                        audio: {

                            echoCancellation:
                                true,

                            noiseSuppression:
                                true,

                            autoGainControl:
                                true

                        }

                    });


            const mimeType =
                chooseMimeType();


            if (!mimeType) {

                stream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );


                stream = null;


                throw new Error(
                    "No supported recording format was found."
                );
            }


            running = true;

            stopping = false;

            segmentNumber = 0;

            liveStartedAt =
                performance.now();


            sendStatus(
                "Live microphone active."
            );


            console.log(
                "[Droplet Live] MIME:",
                mimeType
            );


            startSegmentRecorder(
                mimeType
            );


            scheduleSegmentStop(
                mimeType
            );


            return {

                mimeType,

                segmentMilliseconds:
                    LIVE_SEGMENT_MS,

                startedAt:
                    liveStartedAt

            };
        };


    // --------------------------------------------------------
    // Public: stop live capture
    // --------------------------------------------------------

    window.DropletVoice.stopLiveCapture =
        async function () {

            if (!running) {

                throw new Error(
                    "Live transcription is not active."
                );
            }


            stopping = true;

            running = false;


            if (segmentTimer) {

                clearTimeout(
                    segmentTimer
                );

                segmentTimer = null;
            }


            // Save the final partial segment.
            if (
                mediaRecorder &&
                mediaRecorder.state ===
                    "recording"
            ) {

                await new Promise(
                    resolve => {

                        const oldOnStop =
                            mediaRecorder.onstop;


                        mediaRecorder.onstop =
                            async function () {

                                if (oldOnStop) {

                                    await oldOnStop();
                                }


                                resolve();
                            };


                        mediaRecorder.stop();
                    }
                );
            }


            if (stream) {

                stream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );
            }


            stream = null;

            mediaRecorder = null;

            segmentChunks = [];


            const elapsed =
                liveStartedAt
                    ? (
                        performance.now() -
                        liveStartedAt
                    ) / 1000
                    : 0;


            liveStartedAt = null;


            sendStatus(
                "Live microphone stopped."
            );


            segmentCallback = null;

            statusCallback = null;

            stopping = false;


            return {

                duration:
                    elapsed,

                segments:
                    segmentNumber

            };
        };


    // --------------------------------------------------------
    // Public state
    // --------------------------------------------------------

    window.DropletVoice.isLiveCaptureActive =
        function () {

            return running;
        };


    window.DropletVoice.getLiveCaptureInfo =
        function () {

            return {

                running,

                segmentNumber,

                segmentMilliseconds:
                    LIVE_SEGMENT_MS,

                startedAt:
                    liveStartedAt

            };
        };


    console.log(
        "[Droplet Live] Engine loaded."
    );

})();
