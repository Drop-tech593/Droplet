// ============================================================
// DROPLET VOICE-TO-TEXT
// Microphone Recorder
// ============================================================

window.DropletVoice = window.DropletVoice || {};


// ============================================================
// STATE
// ============================================================

let microphoneStream = null;
let mediaRecorder = null;
let recordedChunks = [];

let recordingStartedAt = null;


// ============================================================
// CHECK MICROPHONE SUPPORT
// ============================================================

window.DropletVoice.canRecordMicrophone = function () {

    return !!(
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia &&
        window.MediaRecorder
    );
};


// ============================================================
// CHOOSE RECORDING FORMAT
// ============================================================

function chooseRecordingMimeType() {

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


    // Let the browser choose.
    return "";
}


// ============================================================
// START RECORDING
// ============================================================

window.DropletVoice.startMicrophoneRecording =
    async function () {


        // --------------------------------------------------------
        // SUPPORT CHECK
        // --------------------------------------------------------

        if (
            !window.DropletVoice.canRecordMicrophone()
        ) {

            throw new Error(
                "Microphone recording is not supported by this browser."
            );
        }


        // --------------------------------------------------------
        // ALREADY RECORDING
        // --------------------------------------------------------

        if (
            mediaRecorder &&
            mediaRecorder.state === "recording"
        ) {

            throw new Error(
                "Microphone is already recording."
            );
        }


        console.log(
            "[Droplet Recorder] Requesting microphone..."
        );


        // --------------------------------------------------------
        // REQUEST MICROPHONE
        // --------------------------------------------------------

        microphoneStream =
            await navigator.mediaDevices.getUserMedia({

                audio: {

                    echoCancellation: true,

                    noiseSuppression: true,

                    autoGainControl: true

                },

                video: false

            });


        console.log(
            "[Droplet Recorder] Microphone granted."
        );


        // --------------------------------------------------------
        // FORMAT
        // --------------------------------------------------------

        const mimeType =
            chooseRecordingMimeType();


        console.log(
            "[Droplet Recorder] MIME type:",
            mimeType || "browser default"
        );


        // --------------------------------------------------------
        // CREATE RECORDER
        // --------------------------------------------------------

        if (mimeType) {

            mediaRecorder =
                new MediaRecorder(
                    microphoneStream,
                    {
                        mimeType
                    }
                );

        } else {

            mediaRecorder =
                new MediaRecorder(
                    microphoneStream
                );
        }


        recordedChunks = [];


        // --------------------------------------------------------
        // RECEIVE AUDIO DATA
        // --------------------------------------------------------

        mediaRecorder.addEventListener(

            "dataavailable",

            function (event) {

                if (
                    event.data &&
                    event.data.size > 0
                ) {

                    recordedChunks.push(
                        event.data
                    );
                }
            }
        );


        // --------------------------------------------------------
        // START
        // --------------------------------------------------------

        recordingStartedAt =
            performance.now();


        mediaRecorder.start(1000);


        console.log(
            "[Droplet Recorder] Recording started."
        );


        return {

            mimeType:
                mediaRecorder.mimeType,

            startedAt:
                recordingStartedAt

        };
    };


// ============================================================
// STOP RECORDING
// ============================================================

window.DropletVoice.stopMicrophoneRecording =
    function () {


        return new Promise(
            (resolve, reject) => {


                // ------------------------------------------------
                // VALIDATE STATE
                // ------------------------------------------------

                if (
                    !mediaRecorder ||
                    mediaRecorder.state === "inactive"
                ) {

                    reject(
                        new Error(
                            "No microphone recording is currently active."
                        )
                    );

                    return;
                }


                // ------------------------------------------------
                // RECORDER ERROR
                // ------------------------------------------------

                mediaRecorder.addEventListener(

                    "error",

                    function (event) {

                        reject(
                            event.error ||
                            new Error(
                                "Microphone recording failed."
                            )
                        );
                    },

                    {
                        once: true
                    }
                );


                // ------------------------------------------------
                // RECORDER STOPPED
                // ------------------------------------------------

                mediaRecorder.addEventListener(

                    "stop",

                    function () {


                        const mimeType =
                            mediaRecorder.mimeType ||
                            "audio/webm";


                        const blob =
                            new Blob(
                                recordedChunks,
                                {
                                    type: mimeType
                                }
                            );


                        const extension =
                            mimeType.includes("ogg")
                                ? "ogg"
                                : "webm";


                        const file =
                            new File(

                                [blob],

                                "droplet-recording-" +
                                    Date.now() +
                                    "." +
                                    extension,

                                {
                                    type: mimeType
                                }
                            );


                        const duration =
                            recordingStartedAt
                                ? (
                                    performance.now() -
                                    recordingStartedAt
                                ) / 1000
                                : null;


                        console.log(
                            "[Droplet Recorder] Recording stopped.",
                            {
                                duration,
                                size: file.size,
                                type: file.type,
                                name: file.name
                            }
                        );


                        // ----------------------------------------
                        // RELEASE MICROPHONE
                        // ----------------------------------------

                        if (microphoneStream) {

                            microphoneStream
                                .getTracks()
                                .forEach(
                                    track =>
                                        track.stop()
                                );
                        }


                        microphoneStream = null;

                        mediaRecorder = null;

                        recordedChunks = [];

                        recordingStartedAt = null;


                        // ----------------------------------------
                        // RETURN FILE
                        // ----------------------------------------

                        resolve({

                            file,

                            duration,

                            mimeType

                        });
                    },

                    {
                        once: true
                    }
                );


                console.log(
                    "[Droplet Recorder] Stopping..."
                );


                mediaRecorder.stop();
            }
        );
    };


// ============================================================
// RECORDING STATUS
// ============================================================

window.DropletVoice.isMicrophoneRecording =
    function () {

        return !!(
            mediaRecorder &&
            mediaRecorder.state === "recording"
        );
    };
