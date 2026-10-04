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

const VERSION = "DIARIZATION-STEP-4B11-SPEAKER-CENTROIDS";

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
   COSINE SIMILARITY
========================================================= */

function cosineSimilarity(a, b) {

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (
        let i = 0;
        i < Math.min(a.length, b.length);
        i++
    ) {

        dot += a[i] * b[i];

        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (
        Math.sqrt(normA) *
        Math.sqrt(normB)
    );
}


/* =========================================================
   STEP 4B.8 — AHC-ONLY SPEAKER CLUSTERING DIAGNOSTIC
========================================================= */

function clusterEmbeddingsAhcOnly(
    captured,
    threshold = 0.75
) {

    if (!Array.isArray(captured) || captured.length === 0) {
        return [];
    }

    /*
     * Each embedding begins as its own cluster.
     */
    const clusters = captured.map(item => ({
        ids: [item.id],
        items: [item]
    }));


    /*
     * Average cosine similarity between two clusters.
     */
    function clusterSimilarity(a, b) {

        let total = 0;
        let comparisons = 0;

        for (const itemA of a.items) {

            for (const itemB of b.items) {

                total += cosineSimilarity(
                    itemA.embedding,
                    itemB.embedding
                );

                comparisons++;
            }
        }

        return comparisons > 0
            ? total / comparisons
            : -1;
    }


    /*
     * Agglomerative clustering.
     *
     * Repeatedly merge the most similar pair while
     * similarity remains >= threshold.
     */
    while (clusters.length > 1) {

        let bestI = -1;
        let bestJ = -1;
        let bestSimilarity = -Infinity;

        for (
            let i = 0;
            i < clusters.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < clusters.length;
                j++
            ) {

                const similarity =
                    clusterSimilarity(
                        clusters[i],
                        clusters[j]
                    );

                if (similarity > bestSimilarity) {

                    bestSimilarity = similarity;
                    bestI = i;
                    bestJ = j;
                }
            }
        }


        /*
         * Stop when no remaining pair passes
         * the AHC threshold.
         */
        if (
            bestI < 0 ||
            bestJ < 0 ||
            bestSimilarity < threshold
        ) {
            break;
        }


        const merged = {

            ids: [
                ...clusters[bestI].ids,
                ...clusters[bestJ].ids
            ],

            items: [
                ...clusters[bestI].items,
                ...clusters[bestJ].items
            ]
        };


        /*
         * Remove higher index first.
         */
        clusters.splice(bestJ, 1);
        clusters.splice(bestI, 1);

        clusters.push(merged);
    }


    /*
     * Give the diagnostic clusters stable speaker labels.
     */
    return clusters
        .map((cluster, index) => ({

            speaker:
                `AHC_SPEAKER_${String(index).padStart(2, "0")}`,

            embeddingIds:
                [...cluster.ids].sort(
                    (a, b) => a - b
                ),

            count:
                cluster.ids.length

        }))
        .sort(
            (a, b) =>
                a.embeddingIds[0] -
                b.embeddingIds[0]
        );
}


/* =========================================================
   STEP 4B.9 — DIARIZATION-JS STYLE AHC

   diarization-js:
   1. L2 normalize embeddings
   2. Euclidean distance
   3. Centroid-linkage AHC
   4. Cut dendrogram at distance threshold
========================================================= */

function l2NormalizeEmbedding(values) {

    let normSquared = 0;

    for (const value of values) {
        normSquared += value * value;
    }

    const norm = Math.sqrt(normSquared);

    if (!Number.isFinite(norm) || norm === 0) {
        return null;
    }

    return Float64Array.from(
        values,
        value => value / norm
    );
}


function euclideanDistance(a, b) {

    let sum = 0;

    for (
        let i = 0;
        i < Math.min(a.length, b.length);
        i++
    ) {

        const difference =
            a[i] - b[i];

        sum +=
            difference * difference;
    }

    return Math.sqrt(sum);
}


function calculateCentroid(members) {

    const dimensions =
        members[0].vector.length;

    const centroid =
        new Float64Array(dimensions);

    let totalWeight = 0;

    for (const member of members) {

        const weight =
            member.weight || 1;

        totalWeight += weight;

        for (
            let d = 0;
            d < dimensions;
            d++
        ) {

            centroid[d] +=
                member.vector[d] *
                weight;
        }
    }

    if (totalWeight > 0) {

        for (
            let d = 0;
            d < dimensions;
            d++
        ) {

            centroid[d] /=
                totalWeight;
        }
    }

    return centroid;
}


function diarizationStyleAhc(
    captured,
    threshold = 0.75
) {

    /*
     * Create one normalized embedding per cluster.
     */
    let clusters = captured
        .map(item => {

            const normalized =
                l2NormalizeEmbedding(
                    item.embedding
                );

            if (!normalized) {
                return null;
            }

            return {

                ids: [item.id],

                members: [
                    {
                        id: item.id,
                        vector: normalized,
                        weight: 1
                    }
                ],

                centroid:
                    normalized,

                size: 1
            };
        })
        .filter(Boolean);


    const mergeHistory = [];


    while (clusters.length > 1) {

        let bestI = -1;
        let bestJ = -1;

        let bestDistance =
            Infinity;


        /*
         * Find closest centroids.
         */
        for (
            let i = 0;
            i < clusters.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < clusters.length;
                j++
            ) {

                const distance =
                    euclideanDistance(
                        clusters[i].centroid,
                        clusters[j].centroid
                    );


                if (distance < bestDistance) {

                    bestDistance =
                        distance;

                    bestI = i;
                    bestJ = j;
                }
            }
        }


        /*
         * scipy fcluster(distance):
         * stop once next linkage distance
         * exceeds threshold.
         */
        if (
            bestI < 0 ||
            bestJ < 0 ||
            bestDistance > threshold
        ) {
            break;
        }


        const left =
            clusters[bestI];

        const right =
            clusters[bestJ];


        const members = [
            ...left.members,
            ...right.members
        ];


        const merged = {

            ids: [
                ...left.ids,
                ...right.ids
            ],

            members,

            centroid:
                calculateCentroid(
                    members
                ),

            size:
                left.size +
                right.size
        };


        mergeHistory.push({

            left:
                [...left.ids],

            right:
                [...right.ids],

            distance:
                bestDistance,

            result:
                [...merged.ids]
        });


        /*
         * Remove higher index first.
         */
        clusters.splice(
            bestJ,
            1
        );

        clusters.splice(
            bestI,
            1
        );

        clusters.push(
            merged
        );
    }


    /*
     * Encounter-order labels, matching the
     * contiguous-label behavior of the package.
     */
    clusters.sort(
        (a, b) =>
            Math.min(...a.ids) -
            Math.min(...b.ids)
    );


    const assignments = [];

    clusters.forEach(
        (cluster, clusterIndex) => {

            for (const id of cluster.ids) {

                assignments.push({

                    embeddingId:
                        id,

                    speaker:
                        `AHC_SPEAKER_${String(
                            clusterIndex
                        ).padStart(2, "0")}`
                });
            }
        }
    );


    assignments.sort(
        (a, b) =>
            a.embeddingId -
            b.embeddingId
    );


    return {

        clusters:
            clusters.map(
                (cluster, index) => ({

                    speaker:
                        `AHC_SPEAKER_${String(
                            index
                        ).padStart(2, "0")}`,

                    embeddingIds:
                        [...cluster.ids]
                            .sort(
                                (a, b) =>
                                    a - b
                            ),

                    count:
                        cluster.ids.length
                })
            ),

        assignments,

        mergeHistory
    };
}


/* =========================================================
   STEP 4B.11 — AHC SPEAKER CENTROID SIMILARITY
========================================================= */

function analyzeAhcSpeakerCentroids(
    ahcResult,
    captured
) {

    const embeddingById =
        new Map(
            captured.map(
                item => [
                    item.id,
                    item.embedding
                ]
            )
        );


    const speakers = [];


    for (
        const cluster of
        ahcResult.clusters
    ) {

        const vectors =
            cluster.embeddingIds
                .map(
                    id =>
                        embeddingById.get(id)
                )
                .filter(Boolean);


        if (vectors.length === 0) {
            continue;
        }


        const dimensions =
            vectors[0].length;


        const centroid =
            new Float64Array(
                dimensions
            );


        for (
            const vector of vectors
        ) {

            for (
                let d = 0;
                d < dimensions;
                d++
            ) {

                centroid[d] +=
                    vector[d];
            }
        }


        for (
            let d = 0;
            d < dimensions;
            d++
        ) {

            centroid[d] /=
                vectors.length;
        }


        const normalized =
            l2NormalizeEmbedding(
                centroid
            );


        speakers.push({

            speaker:
                cluster.speaker,

            embeddingIds:
                [...cluster.embeddingIds],

            count:
                vectors.length,

            centroid:
                normalized
        });
    }


    const comparisons = [];


    for (
        let i = 0;
        i < speakers.length;
        i++
    ) {

        for (
            let j = i + 1;
            j < speakers.length;
            j++
        ) {

            const cosine =
                cosineSimilarity(
                    speakers[i].centroid,
                    speakers[j].centroid
                );


            const distance =
                euclideanDistance(
                    speakers[i].centroid,
                    speakers[j].centroid
                );


            comparisons.push({

                speakerA:
                    speakers[i].speaker,

                speakerB:
                    speakers[j].speaker,

                cosineSimilarity:
                    cosine,

                euclideanDistance:
                    distance
            });
        }
    }


    comparisons.sort(
        (a, b) =>
            b.cosineSimilarity -
            a.cosineSimilarity
    );


    return {
        speakers,
        comparisons
    };
}


/* =========================================================
   STEP 4B.10 — MAP AHC EMBEDDINGS TO SPEECH TIME
========================================================= */

function buildAhcTimeline(
    ahcResult,
    segmentation,
    windowSec
) {

    if (!segmentation) {
        return [];
    }


    const {
        data,
        numChunks,
        numFrames,
        numLocalSpeakers,
        chunkStarts
    } = segmentation;


    if (
        !data ||
        !numChunks ||
        !numFrames ||
        !numLocalSpeakers ||
        !chunkStarts
    ) {
        return [];
    }


    /*
     * Fast lookup:
     *
     * embedding ID -> global AHC speaker
     */

    const speakerByEmbeddingId =
        new Map();


    for (
        const assignment of
        ahcResult.assignments
    ) {

        speakerByEmbeddingId.set(
            assignment.embeddingId,
            assignment.speaker
        );
    }


    const rows = [];


    /*
     * Each embedding ID was originally created as:
     *
     * id =
     *   chunkIndex * numLocalSpeakers
     *   + localSpeaker
     */

    for (
        const [
            embeddingId,
            speaker
        ] of speakerByEmbeddingId
    ) {

        const chunkIndex =
            Math.floor(
                embeddingId /
                numLocalSpeakers
            );


        const localSpeaker =
            embeddingId %
            numLocalSpeakers;


        if (
            chunkIndex < 0 ||
            chunkIndex >= numChunks
        ) {
            continue;
        }


        const chunkStart =
            Number(
                chunkStarts[
                    chunkIndex
                ]
            );


        /*
         * Segmentation frames cover windowSec.
         */

        const frameDuration =
            windowSec /
            numFrames;


        let firstActiveFrame =
            -1;

        let lastActiveFrame =
            -1;

        let activeFrames =
            0;


        for (
            let frame = 0;
            frame < numFrames;
            frame++
        ) {

            const index =
                (
                    chunkIndex *
                    numFrames +
                    frame
                ) *
                numLocalSpeakers +
                localSpeaker;


            if (data[index]) {

                activeFrames++;


                if (
                    firstActiveFrame === -1
                ) {

                    firstActiveFrame =
                        frame;
                }


                lastActiveFrame =
                    frame;
            }
        }


        if (
            firstActiveFrame === -1
        ) {
            continue;
        }


        const start =
            chunkStart +
            firstActiveFrame *
            frameDuration;


        const end =
            chunkStart +
            (
                lastActiveFrame + 1
            ) *
            frameDuration;


        rows.push({

            embeddingId,

            speaker,

            chunkIndex,

            localSpeaker,

            chunkStart,

            start,

            end,

            duration:
                end - start,

            activeFrames
        });
    }


    rows.sort(
        (a, b) => {

            if (a.start !== b.start) {
                return a.start - b.start;
            }

            return (
                a.embeddingId -
                b.embeddingId
            );
        }
    );


    return rows;
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


            /* =========================================================
               STEP 4B.5 — FIND FBANK / FEATURE EXTRACTION API
            ========================================================= */

            console.log(
                "[STEP 4B.5] run() source:",
                pipeline.run.toString()
            );

            console.log(
                "[STEP 4B.5] runStream() source:",
                pipeline.runStream.toString()
            );

            console.log(
                "[STEP 4B.5] clusterAndReconstruct() source:",
                pipeline.clusterAndReconstruct.toString()
            );

            console.log(
                "[STEP 4B.5] Segmentation object:",
                pipeline.segmentation
            );

            console.log(
                "[STEP 4B.5] Segmentation own properties:",
                Object.getOwnPropertyNames(
                    pipeline.segmentation
                )
            );

            console.log(
                "[STEP 4B.5] Segmentation prototype properties:",
                Object.getOwnPropertyNames(
                    Object.getPrototypeOf(
                        pipeline.segmentation
                    )
                )
            );

            for (
                const property of
                Object.getOwnPropertyNames(
                    pipeline.segmentation
                )
            ) {
                try {

                    const value =
                        pipeline.segmentation[property];

                    console.log(
                        `[STEP 4B.5] segmentation.${property}`,
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
                        `[STEP 4B.5] Could not inspect segmentation.${property}`,
                        error
                    );
                }
            }


            /* =========================================================
               STEP 4B.10 — CAPTURE SEGMENTATION OUTPUT

               We need the original segmentation masks so that the
               pre-VBx AHC embedding IDs can be mapped back to time.
            ========================================================= */

            const originalSegmentationRun =
                pipeline.segmentation.run.bind(
                    pipeline.segmentation
                );


            pipeline.segmentation.run =
                async function(audio, options = {}) {

                    const result =
                        await originalSegmentationRun(
                            audio,
                            options
                        );


                    self.__dropletSegmentationResult =
                        result;


                    console.log(
                        "[STEP 4B.10] Segmentation captured:",
                        {
                            numChunks:
                                result.numChunks,

                            numFrames:
                                result.numFrames,

                            numLocalSpeakers:
                                result.numLocalSpeakers,

                            chunkStarts:
                                Array.from(
                                    result.chunkStarts || []
                                )
                        }
                    );


                    return result;
                };


            /* =========================================================
               STEP 4B.6 — CAPTURE SPEAKER EMBEDDINGS
            ========================================================= */

            const originalEmbedBatch =
                pipeline.embedding.embedBatch.bind(
                    pipeline.embedding
                );

            pipeline.embedding.embedBatch =
                async function(items, options = {}) {

                    console.log(
                        "[STEP 4B.6] Embedding batch received:",
                        items.map(item => ({
                            id: item.id,
                            numFrames: item.numFrames,
                            fbankLength: item.fbank.length
                        }))
                    );

                    const result =
                        await originalEmbedBatch(
                            items,
                            options
                        );

                    const captured = [];

                    for (const [id, embedding] of result) {

                        captured.push({
                            id,
                            embedding:
                                Array.from(embedding)
                        });

                        console.log(
                            `[STEP 4B.6] Embedding ${id}:`,
                            {
                                dimensions:
                                    embedding.length,

                                first10:
                                    Array.from(
                                        embedding.slice(0, 10)
                                    )
                            }
                        );
                    }

                    self.__dropletCapturedEmbeddings =
                        captured;

                    return result;
                };


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
     * Reset any previous capture before this run.
     */

    self.__dropletCapturedEmbeddings = [];

    self.__dropletSegmentationResult = null;


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


    /* =========================================================
       STEP 4B.6 — EMBEDDING SIMILARITY MATRIX
    ========================================================= */

    const captured =
        self.__dropletCapturedEmbeddings || [];

    console.log(
        "[STEP 4B.6] Total captured embeddings:",
        captured.length
    );

    if (captured.length >= 2) {

        const matrix = [];

        for (
            let i = 0;
            i < captured.length;
            i++
        ) {

            const row = {
                id: captured[i].id
            };

            for (
                let j = 0;
                j < captured.length;
                j++
            ) {

                row[
                    `vs_${captured[j].id}`
                ] =
                    cosineSimilarity(
                        captured[i].embedding,
                        captured[j].embedding
                    ).toFixed(4);
            }

            matrix.push(row);
        }

        console.log(
            "[STEP 4B.6] COSINE SIMILARITY MATRIX"
        );

        console.table(matrix);
    }


    /* =========================================================
       STEP 4B.8 — TEST EMBEDDINGS WITHOUT PLDA / VBx
    ========================================================= */

    const ahcOnlyThreshold = 0.75;

    const ahcOnlyClusters =
        clusterEmbeddingsAhcOnly(
            captured,
            ahcOnlyThreshold
        );


    console.log(
        "========================================"
    );

    console.log(
        "[STEP 4B.8] AHC-ONLY RESULT"
    );

    console.log(
        "[STEP 4B.8] Threshold:",
        ahcOnlyThreshold
    );

    console.log(
        "[STEP 4B.8] Active embeddings:",
        captured.length
    );

    console.log(
        "[STEP 4B.8] AHC-only speakers:",
        ahcOnlyClusters.length
    );


    console.table(
        ahcOnlyClusters.map(cluster => ({

            speaker:
                cluster.speaker,

            embeddings:
                cluster.embeddingIds.join(", "),

            count:
                cluster.count
        }))
    );


    console.log(
        "[STEP 4B.8] IMPORTANT COMPARISON:",
        {
            ahcOnlyClusters:
                ahcOnlyClusters.length,

            libraryAhcClusters:
                output?.metrics?.numAhcClusters,

            libraryVbxClusters:
                output?.metrics?.numVbxClusters,

            finalSpeakers:
                output?.result?.numSpeakers
        }
    );


    console.log(
        "========================================"
    );


    /* =========================================================
       STEP 4B.9 — REAL AHC ASSIGNMENT DIAGNOSTIC
    ========================================================= */

    const ahc49 =
        diarizationStyleAhc(
            captured,
            pipeline.cfg.ahcThreshold
        );


    console.log(
        "========================================"
    );

    console.log(
        "[STEP 4B.9] DIARIZATION-STYLE AHC"
    );


    console.log(
        "[STEP 4B.9] Distance threshold:",
        pipeline.cfg.ahcThreshold
    );


    console.log(
        "[STEP 4B.9] Cluster count:",
        ahc49.clusters.length
    );


    console.table(
        ahc49.clusters.map(
            cluster => ({

                speaker:
                    cluster.speaker,

                embeddings:
                    cluster.embeddingIds.join(", "),

                count:
                    cluster.count
            })
        )
    );


    console.log(
        "[STEP 4B.9] EMBEDDING ASSIGNMENTS"
    );


    console.table(
        ahc49.assignments
    );


    console.log(
        "[STEP 4B.9] MERGE HISTORY"
    );


    console.table(
        ahc49.mergeHistory.map(
            (merge, index) => ({

                merge:
                    index + 1,

                left:
                    merge.left.join(", "),

                right:
                    merge.right.join(", "),

                distance:
                    merge.distance.toFixed(4),

                result:
                    merge.result.join(", ")
            })
        )
    );


    console.log(
        "[STEP 4B.9] VALIDATION",
        {

            reproducedAhcClusters:
                ahc49.clusters.length,

            libraryAhcClusters:
                output?.metrics?.numAhcClusters,

            libraryVbxClusters:
                output?.metrics?.numVbxClusters,

            finalSpeakers:
                output?.result?.numSpeakers,

            ahcCountMatchesLibrary:
                ahc49.clusters.length ===
                output?.metrics?.numAhcClusters
        }
    );


    console.log(
        "========================================"
    );


    /* =========================================================
       STEP 4B.10 — PRE-VBx SPEAKER TIMELINE
    ========================================================= */

    const segmentation410 =
        self.__dropletSegmentationResult;


    const ahcTimeline410 =
        buildAhcTimeline(
            ahc49,
            segmentation410,
            pipeline.cfg.windowSec
        );


    console.log(
        "========================================"
    );


    console.log(
        "[STEP 4B.10] PRE-VBx AHC TIMELINE"
    );


    console.table(
        ahcTimeline410.map(
            row => ({

                speaker:
                    row.speaker,

                embedding:
                    row.embeddingId,

                chunk:
                    row.chunkIndex,

                localSpeaker:
                    row.localSpeaker,

                start:
                    row.start.toFixed(2),

                end:
                    row.end.toFixed(2),

                duration:
                    row.duration.toFixed(2),

                activeFrames:
                    row.activeFrames
            })
        )
    );


    console.log(
        "[STEP 4B.10] SPEAKER SUMMARY"
    );


    const summary410 = {};


    for (
        const row of
        ahcTimeline410
    ) {

        if (!summary410[row.speaker]) {

            summary410[row.speaker] = {

                embeddings: [],

                firstSeen:
                    Infinity,

                lastSeen:
                    -Infinity,

                activeDuration:
                    0
            };
        }


        const summary =
            summary410[row.speaker];


        summary.embeddings.push(
            row.embeddingId
        );


        summary.firstSeen =
            Math.min(
                summary.firstSeen,
                row.start
            );


        summary.lastSeen =
            Math.max(
                summary.lastSeen,
                row.end
            );


        summary.activeDuration +=
            row.duration;
    }


    console.table(

        Object.entries(
            summary410
        ).map(
            ([speaker, info]) => ({

                speaker,

                embeddings:
                    info.embeddings
                        .sort(
                            (a, b) =>
                                a - b
                        )
                        .join(", "),

                firstSeen:
                    info.firstSeen
                        .toFixed(2),

                lastSeen:
                    info.lastSeen
                        .toFixed(2),

                activeDuration:
                    info.activeDuration
                        .toFixed(2)
            })
        )
    );


    console.log(
        "========================================"
    );


    /* =========================================================
       STEP 4B.11 — COMPARE AHC SPEAKER CENTROIDS
    ========================================================= */

    const centroidAnalysis411 =
        analyzeAhcSpeakerCentroids(
            ahc49,
            captured
        );


    console.log(
        "========================================"
    );


    console.log(
        "[STEP 4B.11] AHC SPEAKER CENTROIDS"
    );


    console.table(

        centroidAnalysis411.speakers.map(
            item => ({

                speaker:
                    item.speaker,

                embeddings:
                    item.embeddingIds.join(", "),

                count:
                    item.count
            })
        )
    );


    console.log(
        "[STEP 4B.11] SPEAKER-TO-SPEAKER SIMILARITY"
    );


    console.table(

        centroidAnalysis411.comparisons.map(
            item => ({

                speakerA:
                    item.speakerA,

                speakerB:
                    item.speakerB,

                cosine:
                    item.cosineSimilarity
                        .toFixed(4),

                distance:
                    item.euclideanDistance
                        .toFixed(4)

            })
        )
    );


    console.log(
        "========================================"
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
