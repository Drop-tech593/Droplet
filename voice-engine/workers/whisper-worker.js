// ============================================================
// DROPLET VOICE-TO-TEXT V2
// Whisper Web Worker
//
// Runs Whisper away from the main page so the UI can remain
// responsive while transcription is happening.
// ============================================================

import {
    pipeline
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";


// ------------------------------------------------------------
// STATE
// ------------------------------------------------------------

let transcriber = null;
let currentModel = null;
let currentDevice = null;


// ------------------------------------------------------------
// SEND MESSAGE TO MAIN PAGE
// ------------------------------------------------------------

function send(type, data = {}) {

    self.postMessage({
        type,
        ...data
    });
}


// ------------------------------------------------------------
// LOAD WHISPER MODEL
// ------------------------------------------------------------

async function loadModel(
    model = "onnx-community/whisper-base.en",
    device = "webgpu"
) {

    // Don't reload the same model unnecessarily.

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


    send("status", {
        message: "Loading Whisper model..."
    });


    send("model-loading", {
        model,
        device
    });


    console.log(
        "[Droplet Worker] Loading:",
        model,
        "on",
        device
    );


    transcriber = await pipeline(

        "automatic-speech-recognition",

        model,

        {
            device,

            progress_callback: (progress) => {

                /*
                 * Model download/loading progress.
                 *
                 * Transformers.js may send several different
                 * progress object shapes, so forward the raw
                 * object to the page.
                 */

                send("model-progress", {
                    progress
                });
            }
        }
    );


    currentModel = model;
    currentDevice = device;


    console.log(
        "[Droplet Worker] Model ready."
    );


    send("model-ready", {
        model,
        device,
        cached: false
    });
}


// ------------------------------------------------------------
// TRANSCRIBE ONE AUDIO JOB
// ------------------------------------------------------------

async function transcribeAudio(
    audioBuffer,
    jobId
) {

    if (!transcriber) {

        throw new Error(
            "Whisper model has not been loaded."
        );
    }


    /*
     * The ArrayBuffer sent by the page is reconstructed
     * as a Float32Array here.
     */

    const audio =
        new Float32Array(audioBuffer);


    if (!audio.length) {

        throw new Error(
            "Worker received empty audio."
        );
    }


    const duration =
        audio.length / 16000;


    console.log(
        "[Droplet Worker] Received",
        audio.length,
        "samples"
    );


    console.log(
        "[Droplet Worker] Duration:",
        duration,
        "seconds"
    );


    send("transcription-start", {
        jobId,
        duration
    });


    send("status", {
        message: "Transcribing..."
    });


    const startTime =
        performance.now();


    /*
     * Keep the exact settings that successfully worked
     * in Voice-to-Text V1.
     */

    const result =
        await transcriber(

            audio,

            {
                chunk_length_s: 20,
                stride_length_s: 3
            }
        );


    const elapsed =
        (performance.now() - startTime) /
        1000;


    console.log(
        "[Droplet Worker] Result:",
        result
    );


    console.log(
        "[Droplet Worker] Time:",
        elapsed,
        "seconds"
    );


    send("transcription-complete", {

        jobId,

        text:
            result?.text || "",

        result,

        elapsed,

        duration
    });
}


// ------------------------------------------------------------
// RECEIVE COMMANDS FROM MAIN PAGE
// ------------------------------------------------------------

self.onmessage = async function(event) {

    const message =
        event.data;


    if (!message) {
        return;
    }


    try {

        // ----------------------------------------------------
        // LOAD MODEL
        // ----------------------------------------------------

        if (message.type === "load-model") {

            await loadModel(
                message.model,
                message.device
            );

            return;
        }


        // ----------------------------------------------------
        // TRANSCRIBE
        // ----------------------------------------------------

        if (message.type === "transcribe") {

            await transcribeAudio(
                message.audioBuffer,
                message.jobId
            );

            return;
        }


        // ----------------------------------------------------
        // PING
        // ----------------------------------------------------

        if (message.type === "ping") {

            send("pong", {
                ready: !!transcriber,
                model: currentModel,
                device: currentDevice
            });

            return;
        }


        console.warn(
            "[Droplet Worker] Unknown message:",
            message
        );


    } catch (error) {

        console.error(
            "[Droplet Worker] Error:",
            error
        );


        send("error", {

            jobId:
                message.jobId || null,

            message:
                error?.message ||
                String(error),

            stack:
                error?.stack || null
        });
    }
};
