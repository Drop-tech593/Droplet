/*
 * Droplet Voice Engine
 * Speaker Diarization Worker
 * Step 4A — model-loading proof
 *
 * Input:
 *   { type: "load-models", device: "webgpu" }
 *   { type: "diarize", audioBuffer, sampleRate }
 *
 * Output:
 *   worker-ready
 *   model-progress
 *   model-ready
 *   diarization-start
 *   diarization-progress
 *   diarization-complete
 *   status
 *   error
 */

const VERSION = "DIARIZATION-STEP-4B4-SIGNATURE";

const DIARIZATION_JS_URL =
    "https://esm.sh/diarization-js@0.1.0?bundle";

const ORT_WEBGPU_URL =
    "https://esm.sh/onnxruntime-web@1.22.0/webgpu?bundle";

const MODEL_BASE =
    "https://huggingface.co/briox/diarization-js-community-1/resolve/main";

const SEGMENTATION_URL =
    `${MODEL_BASE}/segmentation-3.0.onnx`;

const EMBEDDING_URL =
    `${MODEL_BASE}/embedding-resnet34.onnx`;

const PLDA_URL =
    `${MODEL_BASE}/plda-params-vbx.json`;


let pipeline = null;
let loadingPromise = null;
let loadedDevice = null;


/* =========================================================
   MESSAGE HELPER
========================================================= */

function send(type, data = {}) {
    self.postMessage({
        type,
        version: VERSION,
        ...data
    });
}


/* =========================================================
   ERROR SERIALIZER
========================================================= */

function serializeError(error) {
    return {
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: error?.stack || null,
        cause: error?.cause
            ? String(error.cause)
            : null
    };
}


/* =========================================================
   DOWNLOAD BINARY MODEL
========================================================= */

async function fetchBinary(url, label) {

    send("model-progress", {
        stage: "download-start",
        model: label,
        message: `Downloading ${label}...`
    });

    const response = await fetch(url, {
        mode: "cors",
        cache: "force-cache"
    });

    if (!response.ok) {
        throw new Error(
            `${label} download failed: ` +
            `HTTP ${response.status} ${response.statusText}`
        );
    }

    const buffer = await response.arrayBuffer();

    send("model-progress", {
        stage: "download-complete",
        model: label,
        bytes: buffer.byteLength,
        message: `${label} downloaded.`
    });

    return new Uint8Array(buffer);
}


/* =========================================================
   DOWNLOAD JSON
========================================================= */

async function fetchJson(url, label) {

    send("model-progress", {
        stage: "download-start",
        model: label,
        message: `Downloading ${label}...`
    });

    const response = await fetch(url, {
        mode: "cors",
        cache: "force-cache"
    });

    if (!response.ok) {
        throw new Error(
            `${label} download failed: ` +
            `HTTP ${response.status} ${response.statusText}`
        );
    }

    const json = await response.json();

    send("model-progress", {
        stage: "download-complete",
        model: label,
        message: `${label} downloaded.`
    });

    return json;
}


/* =========================================================
   LOAD DIARIZATION MODELS
========================================================= */

async function loadModels(device = "webgpu") {

    /*
     * Already loaded.
     */
    if (
        pipeline &&
        loadedDevice === device
    ) {

        send("model-ready", {
            device: loadedDevice,
            cached: true,
            message:
                "Diarization models already loaded."
        });

        return;
    }


    /*
     * Prevent duplicate model loads.
     */
    if (loadingPromise) {
        return loadingPromise;
    }


    loadingPromise = (async () => {

        try {

            /* ---------------------------------------------
               LOAD JAVASCRIPT RUNTIMES
            --------------------------------------------- */

            send("model-progress", {
                stage: "runtime",
                message:
                    "Loading diarization JavaScript runtime..."
            });


            const [
                diarizationModule,
                ort
            ] = await Promise.all([

                import(DIARIZATION_JS_URL),

                import(ORT_WEBGPU_URL)

            ]);


            /* ---------------------------------------------
               CONFIGURE ONNX RUNTIME
            --------------------------------------------- */

            /*
             * IMPORTANT:
             * ORT was imported through esm.sh, but its WebGPU backend
             * still needs the official JSEP runtime files.
             *
             * Point ORT directly at the matching official
             * onnxruntime-web 1.22.0 distribution.
             */

            const ORT_DIST =
                "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

            ort.env.wasm.wasmPaths = {
                mjs:
                    `${ORT_DIST}ort-wasm-simd-threaded.jsep.mjs`,

                wasm:
                    `${ORT_DIST}ort-wasm-simd-threaded.jsep.wasm`
            };


            /*
             * Droplet currently does not use cross-origin isolation.
             *
             * Force single-threaded WASM so ORT does not attempt to
             * create SharedArrayBuffer-based WASM threads.
             */

            ort.env.wasm.numThreads = 1;


            /*
             * We already have our own dedicated diarization Worker.
             * Do NOT make ORT create another proxy worker.
             */

            ort.env.wasm.proxy = false;


            /*
             * Useful while Step 4 is being developed.
             */

            ort.env.logLevel = "warning";


            console.log(
                "[Droplet Diarization] ONNX Runtime configured.",
                {
                    version: ort.env.versions?.web,
                    threads: ort.env.wasm.numThreads,
                    proxy: ort.env.wasm.proxy,
                    wasmPaths: ort.env.wasm.wasmPaths
                }
            );


            const {
                DiarizationPipeline
            } = diarizationModule;


            if (!DiarizationPipeline) {
                throw new Error(
                    "DiarizationPipeline export was not found."
                );
            }


            if (!ort?.InferenceSession) {
                throw new Error(
                    "ONNX Runtime Web failed to load."
                );
            }


            /* ---------------------------------------------
               CHECK WEBGPU
            --------------------------------------------- */

            if (device === "webgpu") {

                if (!("gpu" in self.navigator)) {

                    throw new Error(
                        "WebGPU is not available " +
                        "inside this browser worker."
                    );
                }


                const adapter =
                    await self.navigator.gpu.requestAdapter();


                if (!adapter) {

                    throw new Error(
                        "WebGPU exists, but no GPU " +
                        "adapter is available."
                    );
                }


                send("model-progress", {
                    stage: "webgpu-ready",
                    message:
                        "WebGPU adapter available."
                });
            }


            /* ---------------------------------------------
               DOWNLOAD MODELS
            --------------------------------------------- */

            const [
                segmentationModel,
                embeddingModel,
                pldaParamsJson
            ] = await Promise.all([

                fetchBinary(
                    SEGMENTATION_URL,
                    "segmentation-3.0.onnx"
                ),

                fetchBinary(
                    EMBEDDING_URL,
                    "embedding-resnet34.onnx"
                ),

                fetchJson(
                    PLDA_URL,
                    "plda-params-vbx.json"
                )

            ]);


            /* ---------------------------------------------
               CREATE PIPELINE
            --------------------------------------------- */

            send("model-progress", {
                stage: "pipeline-create",
                message:
                    "Creating diarization pipeline..."
            });


            pipeline =
                await DiarizationPipeline.create({

                    ort,

                    segmentationModel,

                    embeddingModel,

                    pldaParamsJson,

                    /*
                     * Step 4B.1 diagnostic:
                     *
                     * Default diarization-js AHC threshold = 0.60.
                     *
                     * Our two-speaker recording was incorrectly
                     * merged into one speaker.
                     *
                     * Test a stricter clustering threshold.
                     */
                    ahcThreshold: 0.75

                });


            /* =========================================================
               STEP 4B.2 — PIPELINE INTERNALS DIAGNOSTIC
            ========================================================= */

            console.log(
                "[STEP 4B.2] Pipeline object:",
                pipeline
            );

            console.log(
                "[STEP 4B.2] Pipeline own properties:",
                Object.getOwnPropertyNames(pipeline)
            );

            console.log(
                "[STEP 4B.2] Pipeline prototype properties:",
                Object.getOwnPropertyNames(
                    Object.getPrototypeOf(pipeline)
                )
            );

            for (
                const property of
                Object.getOwnPropertyNames(pipeline)
            ) {
                try {
                    const value = pipeline[property];

                    console.log(
                        `[STEP 4B.2] pipeline.${property}`,
                        {
                            type: typeof value,
                            constructor:
                                value?.constructor?.name || null,
                            value
                        }
                    );
                } catch (error) {
                    console.warn(
                        `[STEP 4B.2] Could not inspect ${property}`,
                        error
                    );
                }
            }


            /* =========================================================
               STEP 4B.3 — EMBEDDING COMPONENT DIAGNOSTIC
            ========================================================= */

            if (pipeline.embedding) {

                console.log(
                    "[STEP 4B.3] Embedding object:",
                    pipeline.embedding
                );

                console.log(
                    "[STEP 4B.3] Embedding own properties:",
                    Object.getOwnPropertyNames(
                        pipeline.embedding
                    )
                );

                console.log(
                    "[STEP 4B.3] Embedding prototype properties:",
                    Object.getOwnPropertyNames(
                        Object.getPrototypeOf(
                            pipeline.embedding
                        )
                    )
                );


                for (
                    const property of
                    Object.getOwnPropertyNames(
                        pipeline.embedding
                    )
                ) {

                    try {

                        const value =
                            pipeline.embedding[property];

                        console.log(
                            `[STEP 4B.3] embedding.${property}`,
                            {
                                type:
                                    typeof value,

                                constructor:
                                    value?.constructor?.name ||
                                    null,

                                value
                            }
                        );

                    } catch (error) {

                        console.warn(
                            `[STEP 4B.3] Could not inspect embedding.${property}`,
                            error
                        );
                    }
                }

            }


            /* =========================================================
               STEP 4B.3 — CONFIGURATION DIAGNOSTIC
            ========================================================= */

            console.log(
                "[STEP 4B.3] Pipeline configuration:",
                pipeline.cfg
            );

            console.log(
                "[STEP 4B.3] PLDA configuration:",
                pipeline.plda
            );


            /* =========================================================
               STEP 4B.4 — EMBEDDING METHOD SIGNATURE DIAGNOSTIC
            ========================================================= */

            console.log(
                "[STEP 4B.4] embed() source:",
                pipeline.embedding.embed.toString()
            );

            console.log(
                "[STEP 4B.4] embedBatch() source:",
                pipeline.embedding.embedBatch.toString()
            );

            console.log(
                "[STEP 4B.4] embed() argument count:",
                pipeline.embedding.embed.length
            );

            console.log(
                "[STEP 4B.4] embedBatch() argument count:",
                pipeline.embedding.embedBatch.length
            );

            console.log(
                "[STEP 4B.4] Embedding ONNX inputs:",
                pipeline.embedding.session.inputNames
            );

            console.log(
                "[STEP 4B.4] Embedding ONNX outputs:",
                pipeline.embedding.session.outputNames
            );


            loadedDevice = device;


            /* ---------------------------------------------
               SUCCESS
            --------------------------------------------- */

            send("model-ready", {

                device,

                cached: false,

                models: {

                    segmentation:
                        "segmentation-3.0.onnx",

                    embedding:
                        "embedding-resnet34.onnx",

                    plda:
                        "plda-params-vbx.json"

                },

                message:
                    "Speaker diarization pipeline ready."
            });


            console.log(
                "[Droplet Diarization] Pipeline ready.",
                {
                    version: VERSION,
                    device
                }
            );

        }

        catch (error) {

            pipeline = null;
            loadedDevice = null;


            console.error(
                "[Droplet Diarization] " +
                "Model loading failed:",
                error
            );


            send("error", {

                stage: "load-models",

                error:
                    serializeError(error)

            });


            throw error;
        }

        finally {

            loadingPromise = null;

        }

    })();


    return loadingPromise;
}


/* =========================================================
   RUN SPEAKER DIARIZATION
========================================================= */

async function diarizeAudio(audioBuffer, sampleRate = 16000) {

    if (!pipeline) {
        throw new Error(
            "Diarization pipeline is not loaded. " +
            "Send load-models first."
        );
    }

    if (!audioBuffer) {
        throw new Error(
            "No audioBuffer was provided for diarization."
        );
    }


    /*
     * The main page transfers the ArrayBuffer from the
     * already-prepared 16 kHz Float32Array.
     */
    const audio = new Float32Array(audioBuffer);


    if (audio.length === 0) {
        throw new Error(
            "The diarization audio buffer is empty."
        );
    }


    const duration =
        audio.length / sampleRate;


    console.log(
        "[Droplet Diarization] Starting analysis.",
        {
            samples: audio.length,
            sampleRate,
            duration
        }
    );


    send("diarization-start", {
        samples: audio.length,
        sampleRate,
        duration
    });


    const startedAt =
        performance.now();


    /*
     * diarization-js API:
     *
     * pipeline.run(
     *     waveform,
     *     sampleRate,
     *     { onProgress }
     * )
     */
    const output =
        await pipeline.run(
            audio,
            sampleRate,
            {
                onProgress: progress => {

                    /*
                     * Keep progress generic for now because
                     * different pipeline stages may report
                     * different progress structures.
                     */

                    send("diarization-progress", {
                        progress
                    });
                }
            }
        );


    const elapsed =
        (performance.now() - startedAt) / 1000;


    /*
     * diarization-js returns:
     *
     * {
     *     result,
     *     metrics
     * }
     */

    const result =
        output?.result || {};


    const metrics =
        output?.metrics || {};


    const rawSegments =
        Array.isArray(result.segments)
            ? result.segments
            : [];


    /*
     * Convert package output into a stable Droplet format.
     */

    const segments =
        rawSegments.map(
            (segment, index) => {

                return {

                    index,

                    start:
                        Number(segment.start),

                    end:
                        Number(segment.end),

                    duration:
                        Number(segment.end) -
                        Number(segment.start),

                    speaker:
                        String(segment.speaker)

                };

            }
        );


    /*
     * Prefer the model's speaker count.
     *
     * Also calculate it ourselves as a safety check.
     */

    const detectedSpeakerLabels =
        [
            ...new Set(
                segments.map(
                    segment =>
                        segment.speaker
                )
            )
        ];


    const numSpeakers =
        Number.isFinite(result.numSpeakers)
            ? result.numSpeakers
            : detectedSpeakerLabels.length;


    console.log(
        "[Droplet Diarization] Analysis complete.",
        {
            speakers: numSpeakers,
            speakerLabels:
                detectedSpeakerLabels,
            segments:
                segments.length,
            audioSeconds:
                duration,
            processingSeconds:
                elapsed,
            realtimeFactor:
                duration > 0
                    ? elapsed / duration
                    : null,
            metrics
        }
    );


    /*
     * Print an easy-to-read speaker timeline.
     */

    console.table(
        segments.map(segment => ({
            speaker:
                segment.speaker,

            start:
                segment.start.toFixed(2),

            end:
                segment.end.toFixed(2),

            duration:
                segment.duration.toFixed(2)
        }))
    );


    send("diarization-complete", {

        numSpeakers,

        speakerLabels:
            detectedSpeakerLabels,

        segments,

        metrics,

        performance: {

            audioSeconds:
                duration,

            processingSeconds:
                elapsed,

            realtimeFactor:
                duration > 0
                    ? elapsed / duration
                    : null

        }

    });
}


/* =========================================================
   WORKER MESSAGE HANDLER
========================================================= */

self.onmessage = async event => {

    const message =
        event.data || {};


    try {

        switch (message.type) {


            /* -----------------------------------------
               LOAD MODELS
            ----------------------------------------- */

            case "load-models":

                await loadModels(
                    message.device || "webgpu"
                );

                break;


            /* -----------------------------------------
               DIARIZE AUDIO
            ----------------------------------------- */

            case "diarize":

                await diarizeAudio(
                    message.audioBuffer,
                    message.sampleRate || 16000
                );

                break;


            /* -----------------------------------------
               STATUS
            ----------------------------------------- */

            case "status":

                send("status", {

                    ready:
                        Boolean(pipeline),

                    loading:
                        Boolean(loadingPromise),

                    device:
                        loadedDevice

                });

                break;


            /* -----------------------------------------
               UNKNOWN COMMAND
            ----------------------------------------- */

            default:

                throw new Error(
                    "Unknown diarization worker message: " +
                    message.type
                );
        }

    }

    catch (error) {

        /*
         * loadModels() already sends its detailed error.
         */
        if (message.type !== "load-models") {

            send("error", {

                stage:
                    message.type || "unknown",

                error:
                    serializeError(error)

            });
        }
    }
};


/* =========================================================
   WORKER STARTUP
========================================================= */

console.log(
    `[Droplet Diarization] Worker loaded: ${VERSION}`
);


send("worker-ready", {
    message:
        "Diarization worker ready."
});
