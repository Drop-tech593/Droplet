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

const VERSION = "DIARIZATION-STEP-4C1-FINAL-SPEAKER-TIMELINE";

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

    const clusters = captured.map(item => ({
        ids: [item.id],
        items: [item]
    }));


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


        clusters.splice(bestJ, 1);
        clusters.splice(bestI, 1);

        clusters.push(merged);
    }


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
   STEP 4B.12 — CONSERVATIVE RECURRENCE-AWARE IDENTITY MERGE
========================================================= */

function mergeRecurringAhcSpeakers(
    ahcResult,
    centroidAnalysis,
    timeline
) {

    const MIN_COSINE = 0.64;

    const MAX_DISTANCE = 0.86;

    const MIN_MARGIN = 0.025;

    const MIN_RELIABLE_CLUSTER_SIZE = 2;


    const speakerInfo =
        new Map();


    for (const cluster of ahcResult.clusters) {

        const rows =
            timeline.filter(
                row =>
                    row.speaker ===
                    cluster.speaker
            );


        const firstSeen =
            rows.length
                ? Math.min(
                    ...rows.map(
                        row => row.start
                    )
                )
                : Infinity;


        const lastSeen =
            rows.length
                ? Math.max(
                    ...rows.map(
                        row => row.end
                    )
                )
                : -Infinity;


        speakerInfo.set(
            cluster.speaker,
            {
                speaker:
                    cluster.speaker,

                embeddingIds:
                    [...cluster.embeddingIds],

                count:
                    cluster.count,

                firstSeen,

                lastSeen
            }
        );
    }


    const pairMap =
        new Map();


    function pairKey(a, b) {

        return [a, b]
            .sort()
            .join("::");
    }


    for (
        const comparison of
        centroidAnalysis.comparisons
    ) {

        pairMap.set(
            pairKey(
                comparison.speakerA,
                comparison.speakerB
            ),
            comparison
        );
    }


    function bestAlternative(
        speaker,
        excludedSpeaker
    ) {

        let best = -Infinity;


        for (
            const comparison of
            centroidAnalysis.comparisons
        ) {

            const involvesSpeaker =
                comparison.speakerA === speaker ||
                comparison.speakerB === speaker;


            if (!involvesSpeaker) {
                continue;
            }


            const other =
                comparison.speakerA === speaker
                    ? comparison.speakerB
                    : comparison.speakerA;


            if (other === excludedSpeaker) {
                continue;
            }


            best =
                Math.max(
                    best,
                    comparison.cosineSimilarity
                );
        }


        return best;
    }


    const parent =
        new Map();


    for (
        const cluster of
        ahcResult.clusters
    ) {

        parent.set(
            cluster.speaker,
            cluster.speaker
        );
    }


    function find(value) {

        let root = value;


        while (
            parent.get(root) !== root
        ) {

            root =
                parent.get(root);
        }


        let current = value;


        while (
            parent.get(current) !== current
        ) {

            const next =
                parent.get(current);

            parent.set(
                current,
                root
            );

            current = next;
        }


        return root;
    }


    function union(a, b) {

        const rootA = find(a);
        const rootB = find(b);


        if (rootA === rootB) {
            return;
        }


        if (rootA < rootB) {

            parent.set(
                rootB,
                rootA
            );

        } else {

            parent.set(
                rootA,
                rootB
            );
        }
    }


    const candidates =
        [...centroidAnalysis.comparisons]
            .sort(
                (a, b) =>
                    b.cosineSimilarity -
                    a.cosineSimilarity
            );


    const decisions = [];


    for (
        const candidate of
        candidates
    ) {

        const infoA =
            speakerInfo.get(
                candidate.speakerA
            );

        const infoB =
            speakerInfo.get(
                candidate.speakerB
            );


        if (!infoA || !infoB) {
            continue;
        }


        if (
            find(candidate.speakerA) ===
            find(candidate.speakerB)
        ) {

            decisions.push({

                speakerA:
                    candidate.speakerA,

                speakerB:
                    candidate.speakerB,

                cosine:
                    candidate.cosineSimilarity,

                distance:
                    candidate.euclideanDistance,

                accepted:
                    false,

                reason:
                    "already-same-identity"
            });

            continue;
        }


        const alternativeA =
            bestAlternative(
                candidate.speakerA,
                candidate.speakerB
            );


        const alternativeB =
            bestAlternative(
                candidate.speakerB,
                candidate.speakerA
            );


        const marginA =
            Number.isFinite(alternativeA)
                ? candidate.cosineSimilarity -
                    alternativeA
                : Infinity;


        const marginB =
            Number.isFinite(alternativeB)
                ? candidate.cosineSimilarity -
                    alternativeB
                : Infinity;


        const temporalGap =
            infoA.lastSeen < infoB.firstSeen
                ? infoB.firstSeen -
                    infoA.lastSeen

                : infoB.lastSeen < infoA.firstSeen
                    ? infoA.firstSeen -
                        infoB.lastSeen

                    : 0;


        const reliableSizes =
            infoA.count >=
                MIN_RELIABLE_CLUSTER_SIZE &&
            infoB.count >=
                MIN_RELIABLE_CLUSTER_SIZE;


        const passesSimilarity =
            candidate.cosineSimilarity >=
                MIN_COSINE;


        const passesDistance =
            candidate.euclideanDistance <=
                MAX_DISTANCE;


        const passesMargin =
            marginA >= MIN_MARGIN ||
            marginB >= MIN_MARGIN;


        const accepted =
            passesSimilarity &&
            passesDistance &&
            passesMargin &&
            reliableSizes;


        let reason = "accepted";


        if (!passesSimilarity) {

            reason =
                "cosine-too-low";

        } else if (!passesDistance) {

            reason =
                "distance-too-high";

        } else if (!reliableSizes) {

            reason =
                "weak-single-embedding-cluster";

        } else if (!passesMargin) {

            reason =
                "ambiguous-match";
        }


        decisions.push({

            speakerA:
                candidate.speakerA,

            speakerB:
                candidate.speakerB,

            cosine:
                candidate.cosineSimilarity,

            distance:
                candidate.euclideanDistance,

            countA:
                infoA.count,

            countB:
                infoB.count,

            alternativeA,

            alternativeB,

            marginA,

            marginB,

            temporalGap,

            accepted,

            reason
        });


        if (accepted) {

            union(
                candidate.speakerA,
                candidate.speakerB
            );
        }
    }


    const groupsByRoot =
        new Map();


    for (
        const cluster of
        ahcResult.clusters
    ) {

        const root =
            find(cluster.speaker);


        if (!groupsByRoot.has(root)) {

            groupsByRoot.set(
                root,
                []
            );
        }


        groupsByRoot
            .get(root)
            .push(
                cluster.speaker
            );
    }


    const rawGroups =
        [...groupsByRoot.values()]
            .map(group =>
                group.sort()
            )
            .sort(
                (a, b) =>
                    a[0].localeCompare(
                        b[0]
                    )
            );


    const groups =
        rawGroups.map(
            (fragments, index) => ({

                speaker:
                    `MERGED_SPEAKER_${String(
                        index
                    ).padStart(2, "0")}`,

                ahcFragments:
                    fragments
            })
        );


    const identityByAhcSpeaker =
        new Map();


    for (
        const group of
        groups
    ) {

        for (
            const fragment of
            group.ahcFragments
        ) {

            identityByAhcSpeaker.set(
                fragment,
                group.speaker
            );
        }
    }


    return {

        groups,

        decisions,

        identityByAhcSpeaker,

        numSpeakers:
            groups.length,

        config: {

            minCosine:
                MIN_COSINE,

            maxDistance:
                MAX_DISTANCE,

            minMargin:
                MIN_MARGIN,

            minReliableClusterSize:
                MIN_RELIABLE_CLUSTER_SIZE
        }
    };
}


/* =========================================================
   STEP 4B.13 — WEAK FRAGMENT IDENTITY DIAGNOSTIC
========================================================= */

function analyzeWeakAhcFragments(
    ahcResult,
    captured,
    identityMerge
) {

    const WEAK_CLUSTER_MAX_SIZE = 1;

    const STRONG_PAIR_COSINE = 0.65;
    const GOOD_PAIR_COSINE = 0.60;


    const embeddingById =
        new Map(
            captured.map(
                item => [
                    item.id,
                    item.embedding
                ]
            )
        );


    const clusterBySpeaker =
        new Map(
            ahcResult.clusters.map(
                cluster => [
                    cluster.speaker,
                    cluster
                ]
            )
        );


    const weakFragments =
        ahcResult.clusters.filter(
            cluster =>
                cluster.count <=
                WEAK_CLUSTER_MAX_SIZE
        );


    const establishedIdentities = [];


    for (
        const group of
        identityMerge.groups
    ) {

        const embeddingIds = [];

        const reliableFragments = [];


        for (
            const ahcSpeaker of
            group.ahcFragments
        ) {

            const cluster =
                clusterBySpeaker.get(
                    ahcSpeaker
                );


            if (!cluster) {
                continue;
            }


            if (
                cluster.count >
                WEAK_CLUSTER_MAX_SIZE
            ) {

                reliableFragments.push(
                    ahcSpeaker
                );


                embeddingIds.push(
                    ...cluster.embeddingIds
                );
            }
        }


        if (embeddingIds.length === 0) {
            continue;
        }


        establishedIdentities.push({

            speaker:
                group.speaker,

            ahcFragments:
                reliableFragments,

            embeddingIds:
                [...embeddingIds].sort(
                    (a, b) => a - b
                )
        });
    }


    function mean(values) {

        if (values.length === 0) {
            return 0;
        }


        return (
            values.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            values.length
        );
    }


    function median(values) {

        if (values.length === 0) {
            return 0;
        }


        const sorted =
            [...values].sort(
                (a, b) => a - b
            );


        const middle =
            Math.floor(
                sorted.length / 2
            );


        if (
            sorted.length % 2 === 0
        ) {

            return (
                sorted[middle - 1] +
                sorted[middle]
            ) / 2;
        }


        return sorted[middle];
    }


    function topKMean(
        values,
        k
    ) {

        if (values.length === 0) {
            return 0;
        }


        const selected =
            [...values]
                .sort(
                    (a, b) => b - a
                )
                .slice(
                    0,
                    Math.min(
                        k,
                        values.length
                    )
                );


        return mean(selected);
    }


    const analyses = [];


    for (
        const weakCluster of
        weakFragments
    ) {

        const weakEmbeddingIds =
            [...weakCluster.embeddingIds];


        const weakVectors =
            weakEmbeddingIds
                .map(
                    id => ({
                        id,
                        vector:
                            embeddingById.get(id)
                    })
                )
                .filter(
                    item => item.vector
                );


        const identityComparisons = [];


        for (
            const identity of
            establishedIdentities
        ) {

            if (
                identity.ahcFragments.includes(
                    weakCluster.speaker
                )
            ) {
                continue;
            }


            const pairComparisons = [];


            for (
                const weakItem of
                weakVectors
            ) {

                for (
                    const candidateId of
                    identity.embeddingIds
                ) {

                    const candidateVector =
                        embeddingById.get(
                            candidateId
                        );


                    if (!candidateVector) {
                        continue;
                    }


                    const cosine =
                        cosineSimilarity(
                            weakItem.vector,
                            candidateVector
                        );


                    pairComparisons.push({

                        weakEmbeddingId:
                            weakItem.id,

                        candidateEmbeddingId:
                            candidateId,

                        cosine
                    });
                }
            }


            if (
                pairComparisons.length === 0
            ) {
                continue;
            }


            pairComparisons.sort(
                (a, b) =>
                    b.cosine -
                    a.cosine
            );


            const cosineValues =
                pairComparisons.map(
                    item => item.cosine
                );


            const maxCosine =
                Math.max(
                    ...cosineValues
                );


            const meanCosine =
                mean(
                    cosineValues
                );


            const medianCosine =
                median(
                    cosineValues
                );


            const top2Mean =
                topKMean(
                    cosineValues,
                    2
                );


            const top3Mean =
                topKMean(
                    cosineValues,
                    3
                );


            const strongMatches =
                cosineValues.filter(
                    value =>
                        value >=
                        STRONG_PAIR_COSINE
                ).length;


            const goodMatches =
                cosineValues.filter(
                    value =>
                        value >=
                        GOOD_PAIR_COSINE
                ).length;


            identityComparisons.push({

                identity:
                    identity.speaker,

                ahcFragments:
                    [...identity.ahcFragments],

                candidateEmbeddingIds:
                    [...identity.embeddingIds],

                comparisons:
                    pairComparisons,

                maxCosine,

                meanCosine,

                medianCosine,

                top2Mean,

                top3Mean,

                strongMatches,

                goodMatches,

                totalMatches:
                    cosineValues.length
            });
        }


        identityComparisons.sort(
            (a, b) => {

                if (
                    b.top3Mean !==
                    a.top3Mean
                ) {

                    return (
                        b.top3Mean -
                        a.top3Mean
                    );
                }


                if (
                    b.medianCosine !==
                    a.medianCosine
                ) {

                    return (
                        b.medianCosine -
                        a.medianCosine
                    );
                }


                return (
                    b.maxCosine -
                    a.maxCosine
                );
            }
        );


        const best =
            identityComparisons[0] ||
            null;


        const secondBest =
            identityComparisons[1] ||
            null;


        const top3Margin =
            best && secondBest
                ? best.top3Mean -
                    secondBest.top3Mean
                : Infinity;


        const medianMargin =
            best && secondBest
                ? best.medianCosine -
                    secondBest.medianCosine
                : Infinity;


        const maxMargin =
            best && secondBest
                ? best.maxCosine -
                    secondBest.maxCosine
                : Infinity;


        analyses.push({

            weakSpeaker:
                weakCluster.speaker,

            weakEmbeddingIds,

            candidateIdentities:
                identityComparisons,

            bestIdentity:
                best?.identity || null,

            secondBestIdentity:
                secondBest?.identity || null,

            top3Margin,

            medianMargin,

            maxMargin
        });
    }


    return {

        weakFragments:
            weakFragments.map(
                cluster => ({

                    speaker:
                        cluster.speaker,

                    embeddingIds:
                        [...cluster.embeddingIds],

                    count:
                        cluster.count
                })
            ),

        establishedIdentities,

        analyses,

        config: {

            weakClusterMaxSize:
                WEAK_CLUSTER_MAX_SIZE,

            strongPairCosine:
                STRONG_PAIR_COSINE,

            goodPairCosine:
                GOOD_PAIR_COSINE
        }
    };
}


/* =========================================================
   STEP 4B.14 — FINAL SPEAKER IDENTITY MERGE
========================================================= */

function buildFinalSpeakerIdentities(
    ahcResult,
    identityMerge412,
    weakAnalysis413
) {

    const MIN_TOP3 = 0.58;
    const MIN_TOP3_MARGIN = 0.08;
    const MIN_MEDIAN_MARGIN = 0.07;
    const MIN_MAX_MARGIN = 0.07;

    const MIN_GOOD_MATCHES = 1;


    const groups =
        identityMerge412.groups.map(
            group => ({

                speaker:
                    group.speaker,

                ahcFragments:
                    [...group.ahcFragments]
            })
        );


    function findGroupContaining(
        ahcSpeaker
    ) {

        return groups.find(
            group =>
                group.ahcFragments.includes(
                    ahcSpeaker
                )
        ) || null;
    }


    const weakSpeakers =
        new Set(
            weakAnalysis413
                .weakFragments
                .map(
                    fragment =>
                        fragment.speaker
                )
        );


    for (
        let i = groups.length - 1;
        i >= 0;
        i--
    ) {

        groups[i].ahcFragments =
            groups[i].ahcFragments.filter(
                fragment =>
                    !weakSpeakers.has(
                        fragment
                    )
            );


        if (
            groups[i].ahcFragments.length === 0
        ) {

            groups.splice(
                i,
                1
            );
        }
    }


    const decisions = [];


    for (
        const analysis of
        weakAnalysis413.analyses
    ) {

        const weakSpeaker =
            analysis.weakSpeaker;


        const best =
            analysis.candidateIdentities[0] ||
            null;


        const second =
            analysis.candidateIdentities[1] ||
            null;


        if (!best) {

            decisions.push({

                weakSpeaker,

                accepted:
                    false,

                targetIdentity:
                    null,

                reason:
                    "no-candidate-identity"
            });

            continue;
        }


        const top3Margin =
            second
                ? best.top3Mean -
                    second.top3Mean
                : Infinity;


        const medianMargin =
            second
                ? best.medianCosine -
                    second.medianCosine
                : Infinity;


        const maxMargin =
            second
                ? best.maxCosine -
                    second.maxCosine
                : Infinity;


        const passesAbsoluteEvidence =
            best.top3Mean >=
                MIN_TOP3;


        const passesTop3Margin =
            top3Margin >=
                MIN_TOP3_MARGIN;


        const passesMedianMargin =
            medianMargin >=
                MIN_MEDIAN_MARGIN;


        const passesMaxMargin =
            maxMargin >=
                MIN_MAX_MARGIN;


        const passesSupport =
            best.goodMatches >=
                MIN_GOOD_MATCHES;


        const accepted =
            passesAbsoluteEvidence &&
            passesTop3Margin &&
            passesMedianMargin &&
            passesMaxMargin &&
            passesSupport;


        let reason =
            "accepted";


        if (!passesAbsoluteEvidence) {

            reason =
                "top3-evidence-too-low";

        } else if (!passesSupport) {

            reason =
                "not-enough-supporting-matches";

        } else if (!passesTop3Margin) {

            reason =
                "top3-margin-too-small";

        } else if (!passesMedianMargin) {

            reason =
                "median-margin-too-small";

        } else if (!passesMaxMargin) {

            reason =
                "max-margin-too-small";
        }


        decisions.push({

            weakSpeaker,

            bestIdentity:
                best.identity,

            secondBestIdentity:
                second?.identity ||
                null,

            bestTop3:
                best.top3Mean,

            bestMedian:
                best.medianCosine,

            bestMax:
                best.maxCosine,

            goodMatches:
                best.goodMatches,

            strongMatches:
                best.strongMatches,

            top3Margin,

            medianMargin,

            maxMargin,

            accepted,

            targetIdentity:
                accepted
                    ? best.identity
                    : null,

            reason
        });


        if (!accepted) {
            continue;
        }


        const sourceIdentity =
            weakAnalysis413
                .establishedIdentities
                .find(
                    identity =>
                        identity.speaker ===
                        best.identity
                );


        if (!sourceIdentity) {
            continue;
        }


        let targetGroup = null;


        for (
            const fragment of
            sourceIdentity.ahcFragments
        ) {

            targetGroup =
                findGroupContaining(
                    fragment
                );


            if (targetGroup) {
                break;
            }
        }


        if (!targetGroup) {
            continue;
        }


        if (
            !targetGroup
                .ahcFragments
                .includes(
                    weakSpeaker
                )
        ) {

            targetGroup
                .ahcFragments
                .push(
                    weakSpeaker
                );
        }
    }


    for (
        const weakFragment of
        weakAnalysis413.weakFragments
    ) {

        const alreadyAssigned =
            groups.some(
                group =>
                    group
                        .ahcFragments
                        .includes(
                            weakFragment.speaker
                        )
            );


        if (!alreadyAssigned) {

            groups.push({

                speaker:
                    null,

                ahcFragments: [
                    weakFragment.speaker
                ]
            });
        }
    }


    groups.sort(
        (a, b) => {

            const firstA =
                a.ahcFragments
                    .slice()
                    .sort()[0];

            const firstB =
                b.ahcFragments
                    .slice()
                    .sort()[0];


            return firstA.localeCompare(
                firstB
            );
        }
    );


    groups.forEach(
        (group, index) => {

            group.speaker =
                `FINAL_SPEAKER_${String(
                    index
                ).padStart(2, "0")}`;


            group.ahcFragments.sort();
        }
    );


    const identityByAhcSpeaker =
        new Map();


    for (
        const group of groups
    ) {

        for (
            const fragment of
            group.ahcFragments
        ) {

            identityByAhcSpeaker.set(
                fragment,
                group.speaker
            );
        }
    }


    return {

        groups,

        decisions,

        identityByAhcSpeaker,

        numSpeakers:
            groups.length,

        config: {

            minTop3:
                MIN_TOP3,

            minTop3Margin:
                MIN_TOP3_MARGIN,

            minMedianMargin:
                MIN_MEDIAN_MARGIN,

            minMaxMargin:
                MIN_MAX_MARGIN,

            minGoodMatches:
                MIN_GOOD_MATCHES
        }
    };
}


/* =========================================================
   STEP 4C.1 — FINAL TIMESTAMPED SPEAKER TIMELINE
========================================================= */

function buildFinalSpeakerTimeline(
    librarySegments,
    ahcTimeline,
    finalIdentity414
) {

    if (
        !Array.isArray(librarySegments) ||
        librarySegments.length === 0
    ) {
        return [];
    }


    if (
        !Array.isArray(ahcTimeline) ||
        ahcTimeline.length === 0
    ) {
        return [];
    }


    const finalSpeakerByAhc =
        finalIdentity414.identityByAhcSpeaker;


    function overlapDuration(
        startA,
        endA,
        startB,
        endB
    ) {

        return Math.max(
            0,
            Math.min(endA, endB) -
            Math.max(startA, startB)
        );
    }


    const timeline = [];


    for (
        let segmentIndex = 0;
        segmentIndex < librarySegments.length;
        segmentIndex++
    ) {

        const segment =
            librarySegments[segmentIndex];


        const start =
            Number(segment.start);

        const end =
            Number(segment.end);


        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= start
        ) {
            continue;
        }


        const scoreByFinalSpeaker =
            new Map();


        const evidenceByFinalSpeaker =
            new Map();


        for (
            const row of ahcTimeline
        ) {

            const finalSpeaker =
                finalSpeakerByAhc.get(
                    row.speaker
                );


            if (!finalSpeaker) {
                continue;
            }


            const overlap =
                overlapDuration(
                    start,
                    end,
                    row.start,
                    row.end
                );


            if (overlap <= 0) {
                continue;
            }


            const rowDuration =
                Math.max(
                    0.001,
                    row.end - row.start
                );


            const overlapRatio =
                overlap /
                rowDuration;


            const activeWeight =
                Math.max(
                    1,
                    Number(
                        row.activeFrames
                    ) || 1
                );


            const score =
                overlapRatio *
                activeWeight;


            scoreByFinalSpeaker.set(
                finalSpeaker,
                (
                    scoreByFinalSpeaker.get(
                        finalSpeaker
                    ) || 0
                ) + score
            );


            if (
                !evidenceByFinalSpeaker.has(
                    finalSpeaker
                )
            ) {

                evidenceByFinalSpeaker.set(
                    finalSpeaker,
                    []
                );
            }


            evidenceByFinalSpeaker
                .get(finalSpeaker)
                .push({

                    ahcSpeaker:
                        row.speaker,

                    embeddingId:
                        row.embeddingId,

                    overlap,

                    overlapRatio,

                    activeFrames:
                        row.activeFrames,

                    score
                });
        }


        const ranked =
            [...scoreByFinalSpeaker.entries()]
                .map(
                    ([speaker, score]) => ({
                        speaker,
                        score,
                        evidence:
                            evidenceByFinalSpeaker.get(
                                speaker
                            ) || []
                    })
                )
                .sort(
                    (a, b) =>
                        b.score - a.score
                );


        const best =
            ranked[0] || null;


        const second =
            ranked[1] || null;


        timeline.push({

            segmentIndex,

            start,

            end,

            duration:
                end - start,

            speaker:
                best?.speaker ||
                "FINAL_SPEAKER_UNKNOWN",

            score:
                best?.score || 0,

            secondSpeaker:
                second?.speaker ||
                null,

            secondScore:
                second?.score || 0,

            scoreMargin:
                best
                    ? best.score -
                        (
                            second?.score ||
                            0
                        )
                    : 0,

            evidence:
                best?.evidence || []
        });
    }


    return timeline;
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


    if (loadingPromise) {
        return loadingPromise;
    }


    loadingPromise = (async () => {

        try {

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


            const ORT_DIST =
                "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

            ort.env.wasm.wasmPaths = {
                mjs:
                    `${ORT_DIST}ort-wasm-simd-threaded.jsep.mjs`,

                wasm:
                    `${ORT_DIST}ort-wasm-simd-threaded.jsep.wasm`
            };


            ort.env.wasm.numThreads = 1;


            ort.env.wasm.proxy = false;


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

                    ahcThreshold: 0.75

                });


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


            console.log(
                "[STEP 4B.3] Pipeline configuration:",
                pipeline.cfg
            );

            console.log(
                "[STEP 4B.3] PLDA configuration:",
                pipeline.plda
            );


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


    self.__dropletCapturedEmbeddings = [];

    self.__dropletSegmentationResult = null;


    const output =
        await pipeline.run(
            audio,
            sampleRate,
            {
                onProgress: progress => {

                    send("diarization-progress", {
                        progress
                    });
                }
            }
        );


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


    const identityMerge412 =
        mergeRecurringAhcSpeakers(
            ahc49,
            centroidAnalysis411,
            ahcTimeline410
        );


    console.log(
        "========================================"
    );


    console.log(
        "[STEP 4B.12] RECURRENCE-AWARE IDENTITY MERGE"
    );


    console.log(
        "[STEP 4B.12] Configuration:",
        identityMerge412.config
    );


    console.log(
        "[STEP 4B.12] MERGE DECISIONS"
    );


    console.table(
        identityMerge412.decisions.map(
            decision => ({
                speakerA:
                    decision.speakerA,

                speakerB:
                    decision.speakerB,

                cosine:
                    Number.isFinite(decision.cosine)
                        ? decision.cosine.toFixed(4)
                        : decision.cosine,

                distance:
                    Number.isFinite(decision.distance)
                        ? decision.distance.toFixed(4)
                        : decision.distance,

                countA:
                    decision.countA ?? "",

                countB:
                    decision.countB ?? "",

                marginA:
                    Number.isFinite(decision.marginA)
                        ? decision.marginA.toFixed(4)
                        : "",

                marginB:
                    Number.isFinite(decision.marginB)
                        ? decision.marginB.toFixed(4)
                        : "",

                temporalGap:
                    Number.isFinite(decision.temporalGap)
                        ? decision.temporalGap.toFixed(2)
                        : "",

                accepted:
                    decision.accepted,

                reason:
                    decision.reason
            })
        )
    );


    console.log(
        "[STEP 4B.12] MERGED SPEAKER IDENTITIES"
    );


    console.table(
        identityMerge412.groups.map(
            group => ({
                speaker:
                    group.speaker,

                ahcFragments:
                    group.ahcFragments.join(", ")
            })
        )
    );


    console.log(
        "[STEP 4B.12] RESULT",
        {
            ahcFragments:
                ahc49.clusters.length,

            mergedSpeakerIdentities:
                identityMerge412.numSpeakers,

            libraryAhcClusters:
                output?.metrics?.numAhcClusters,

            libraryVbxClusters:
                output?.metrics?.numVbxClusters,

            libraryFinalSpeakers:
                output?.result?.numSpeakers
        }
    );


    console.log(
        "========================================"
    );


    const weakFragmentAnalysis413 =
        analyzeWeakAhcFragments(
            ahc49,
            captured,
            identityMerge412
        );


    console.log(
        "========================================"
    );


    console.log(
        "[STEP 4B.13] WEAK FRAGMENT IDENTITY DIAGNOSTIC"
    );


    console.log(
        "[STEP 4B.13] Configuration:",
        weakFragmentAnalysis413.config
    );


    console.log(
        "[STEP 4B.13] WEAK AHC FRAGMENTS"
    );


    console.table(
        weakFragmentAnalysis413
            .weakFragments
            .map(
                fragment => ({

                    speaker:
                        fragment.speaker,

                    embeddings:
                        fragment.embeddingIds.join(
                            ", "
                        ),

                    count:
                        fragment.count
                })
            )
    );


    console.log(
        "[STEP 4B.13] ESTABLISHED IDENTITIES"
    );


    console.table(
        weakFragmentAnalysis413
            .establishedIdentities
            .map(
                identity => ({

                    identity:
                        identity.speaker,

                    ahcFragments:
                        identity.ahcFragments.join(
                            ", "
                        ),

                    embeddings:
                        identity.embeddingIds.join(
                            ", "
                        ),

                    count:
                        identity.embeddingIds.length
                })
            )
    );


    for (
        const analysis of
        weakFragmentAnalysis413.analyses
    ) {

        console.log(
            "----------------------------------------"
        );


        console.log(
            `[STEP 4B.13] Weak fragment: ${analysis.weakSpeaker}`,
            {
                embeddingIds:
                    analysis.weakEmbeddingIds,

                bestIdentity:
                    analysis.bestIdentity,

                secondBestIdentity:
                    analysis.secondBestIdentity,

                top3Margin:
                    analysis.top3Margin,

                medianMargin:
                    analysis.medianMargin,

                maxMargin:
                    analysis.maxMargin
            }
        );


        console.log(
            `[STEP 4B.13] IDENTITY SCORES — ${analysis.weakSpeaker}`
        );


        console.table(
            analysis.candidateIdentities.map(
                candidate => ({

                    identity:
                        candidate.identity,

                    ahcFragments:
                        candidate.ahcFragments.join(
                            ", "
                        ),

                    candidateEmbeddings:
                        candidate.candidateEmbeddingIds.join(
                            ", "
                        ),

                    max:
                        candidate.maxCosine.toFixed(
                            4
                        ),

                    median:
                        candidate.medianCosine.toFixed(
                            4
                        ),

                    mean:
                        candidate.meanCosine.toFixed(
                            4
                        ),

                    top2:
                        candidate.top2Mean.toFixed(
                            4
                        ),

                    top3:
                        candidate.top3Mean.toFixed(
                            4
                        ),

                    strongMatches:
                        candidate.strongMatches,

                    goodMatches:
                        candidate.goodMatches,

                    total:
                        candidate.totalMatches
                })
            )
        );


        for (
            const candidate of
            analysis.candidateIdentities
        ) {

            console.log(
                `[STEP 4B.13] RAW PAIRS — ${analysis.weakSpeaker} vs ${candidate.identity}`
            );


            console.table(
                candidate.comparisons.map(
                    pair => ({

                        weakEmbedding:
                            pair.weakEmbeddingId,

                        candidateEmbedding:
                            pair.candidateEmbeddingId,

                        cosine:
                            pair.cosine.toFixed(
                                4
                            )
                    })
                )
            );
        }
    }


    console.log(
        "[STEP 4B.13] SUMMARY"
    );


    console.table(
        weakFragmentAnalysis413
            .analyses
            .map(
                analysis => {

                    const best =
                        analysis
                            .candidateIdentities[0];

                    const second =
                        analysis
                            .candidateIdentities[1];


                    return {

                        weakSpeaker:
                            analysis.weakSpeaker,

                        embeddings:
                            analysis
                                .weakEmbeddingIds
                                .join(", "),

                        bestIdentity:
                            analysis.bestIdentity,

                        bestTop3:
                            best
                                ? best.top3Mean
                                    .toFixed(4)
                                : "",

                        bestMedian:
                            best
                                ? best.medianCosine
                                    .toFixed(4)
                                : "",

                        bestMax:
                            best
                                ? best.maxCosine
                                    .toFixed(4)
                                : "",

                        secondIdentity:
                            analysis.secondBestIdentity,

                        secondTop3:
                            second
                                ? second.top3Mean
                                    .toFixed(4)
                                : "",

                        top3Margin:
                            Number.isFinite(
                                analysis.top3Margin
                            )
                                ? analysis
                                    .top3Margin
                                    .toFixed(4)
                                : "",

                        medianMargin:
                            Number.isFinite(
                                analysis.medianMargin
                            )
                                ? analysis
                                    .medianMargin
                                    .toFixed(4)
                                : "",

                        maxMargin:
                            Number.isFinite(
                                analysis.maxMargin
                            )
                                ? analysis
                                    .maxMargin
                                    .toFixed(4)
                                : ""
                    };
                }
            )
    );


    console.log(
        "========================================"
    );


    const finalIdentity414 =
        buildFinalSpeakerIdentities(
            ahc49,
            identityMerge412,
            weakFragmentAnalysis413
        );


    console.log(
        "========================================"
    );


    console.log(
        "[STEP 4B.14] FINAL SPEAKER IDENTITY MERGE"
    );


    console.log(
        "[STEP 4B.14] Configuration:",
        finalIdentity414.config
    );


    console.log(
        "[STEP 4B.14] WEAK FRAGMENT DECISIONS"
    );


    console.table(
        finalIdentity414
            .decisions
            .map(
                decision => ({

                    weakSpeaker:
                        decision.weakSpeaker,

                    bestIdentity:
                        decision.bestIdentity || "",

                    secondIdentity:
                        decision.secondBestIdentity || "",

                    bestTop3:
                        Number.isFinite(
                            decision.bestTop3
                        )
                            ? decision.bestTop3
                                .toFixed(4)
                            : "",

                    goodMatches:
                        decision.goodMatches ?? "",

                    top3Margin:
                        Number.isFinite(
                            decision.top3Margin
                        )
                            ? decision.top3Margin
                                .toFixed(4)
                            : "",

                    medianMargin:
                        Number.isFinite(
                            decision.medianMargin
                        )
                            ? decision.medianMargin
                                .toFixed(4)
                            : "",

                    maxMargin:
                        Number.isFinite(
                            decision.maxMargin
                        )
                            ? decision.maxMargin
                                .toFixed(4)
                            : "",

                    accepted:
                        decision.accepted,

                    target:
                        decision.targetIdentity || "",

                    reason:
                        decision.reason
                })
            )
    );


    console.log(
        "[STEP 4B.14] FINAL IDENTITIES"
    );


    console.table(
        finalIdentity414
            .groups
            .map(
                group => ({

                    speaker:
                        group.speaker,

                    ahcFragments:
                        group
                            .ahcFragments
                            .join(", "),

                    fragmentCount:
                        group
                            .ahcFragments
                            .length
                })
            )
    );


    console.log(
        "[STEP 4B.14] RESULT",
        {

            originalAhcFragments:
                ahc49.clusters.length,

            afterStrongMerge:
                identityMerge412.numSpeakers,

            finalSpeakers:
                finalIdentity414.numSpeakers,

            libraryAhcClusters:
                output?.metrics?.numAhcClusters,

            libraryVbxClusters:
                output?.metrics?.numVbxClusters,

            libraryFinalSpeakers:
                output?.result?.numSpeakers
        }
    );


    console.log(
        "========================================"
    );


    /* =========================================================
       STEP 4C.1 — FINAL TIMESTAMPED SPEAKER TIMELINE
    ========================================================= */

    const preciseSpeechSegments =
        Array.isArray(
            output?.result?.segments
        )
            ? output.result.segments
            : [];


    const finalTimeline4C1 =
        buildFinalSpeakerTimeline(
            preciseSpeechSegments,
            ahcTimeline410,
            finalIdentity414
        );


    console.log(
        "========================================"
    );


    console.log(
        "[STEP 4C.1] FINAL SPEAKER TIMELINE"
    );


    console.log(
        "[STEP 4C.1] Segments:",
        finalTimeline4C1.length
    );


    console.table(
        finalTimeline4C1.map(
            row => ({

                speaker:
                    row.speaker,

                start:
                    row.start.toFixed(2),

                end:
                    row.end.toFixed(2),

                duration:
                    row.duration.toFixed(2),

                score:
                    row.score.toFixed(4),

                secondSpeaker:
                    row.secondSpeaker || "",

                scoreMargin:
                    row.scoreMargin.toFixed(4)
            })
        )
    );


    console.log(
        "========================================"
    );


    const elapsed =
        (performance.now() - startedAt) / 1000;


    const result =
        output?.result || {};


    const metrics =
        output?.metrics || {};


    const rawSegments =
        Array.isArray(result.segments)
            ? result.segments
            : [];


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


            case "load-models":

                await loadModels(
                    message.device || "webgpu"
                );

                break;


            case "diarize":

                await diarizeAudio(
                    message.audioBuffer,
                    message.sampleRate || 16000
                );

                break;


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


            default:

                throw new Error(
                    "Unknown diarization worker message: " +
                    message.type
                );
        }

    }

    catch (error) {

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
