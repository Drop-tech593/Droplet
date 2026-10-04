// ============================================================
// DROPLET VOICE-TO-TEXT
// Audio Processor
//
// Purpose:
// 1. Read uploaded audio
// 2. Decode M4A / MP3 / WAV etc.
// 3. Convert stereo to mono
// 4. Resample audio to 16,000 Hz
// 5. Normalize quiet speech to a safe peak level
// 6. Return Float32Array for Whisper
// ============================================================

window.DropletVoice = window.DropletVoice || {};


// ============================================================
// STEP 16 - SAFE SPEECH NORMALIZATION
// ============================================================

function normalizeSpeechAudio(audio) {

    if (!audio || audio.length === 0) {
        return audio;
    }

    let peak = 0;

    let sumSquares = 0;


    // --------------------------------------------------------
    // MEASURE CURRENT AUDIO
    // --------------------------------------------------------

    for (let i = 0; i < audio.length; i++) {

        const sample = audio[i];

        const absolute =
            Math.abs(sample);


        if (absolute > peak) {
            peak = absolute;
        }


        sumSquares +=
            sample * sample;
    }


    const rms =
        Math.sqrt(
            sumSquares /
            audio.length
        );


    console.log(
        "[Droplet Audio] Before normalization",
        {
            peak,
            rms
        }
    );


    // Completely silent / invalid audio.
    if (peak < 0.00001) {

        console.log(
            "[Droplet Audio] Audio effectively silent - normalization skipped"
        );

        return audio;
    }


    // --------------------------------------------------------
    // TARGET
    //
    // We don't normalize all the way to 1.0.
    // Leave headroom for peaks.
    // --------------------------------------------------------

    const TARGET_PEAK = 0.85;


    let gain =
        TARGET_PEAK /
        peak;


    // --------------------------------------------------------
    // GAIN PROTECTION
    //
    // Never amplify by more than 8x.
    //
    // This prevents very quiet recordings/background noise
    // from being amplified ridiculously.
    // --------------------------------------------------------

    const MAX_GAIN = 8;


    gain =
        Math.min(
            gain,
            MAX_GAIN
        );


    // Don't reduce normal recordings unless they are
    // already close to clipping.

    if (
        peak < 0.95 &&
        gain < 1
    ) {

        gain = 1;
    }


    console.log(
        "[Droplet Audio] Applying normalization",
        {
            gain,
            gainDB:
                20 *
                Math.log10(gain)
        }
    );


    // --------------------------------------------------------
    // APPLY GAIN
    // --------------------------------------------------------

    const normalized =
        new Float32Array(
            audio.length
        );


    let normalizedPeak = 0;

    let normalizedSquares = 0;


    for (
        let i = 0;
        i < audio.length;
        i++
    ) {

        let sample =
            audio[i] *
            gain;


        // Safety limiter.
        if (sample > 0.98) {
            sample = 0.98;
        }

        if (sample < -0.98) {
            sample = -0.98;
        }


        normalized[i] =
            sample;


        const absolute =
            Math.abs(sample);


        if (
            absolute >
            normalizedPeak
        ) {

            normalizedPeak =
                absolute;
        }


        normalizedSquares +=
            sample * sample;
    }


    const normalizedRms =
        Math.sqrt(
            normalizedSquares /
            normalized.length
        );


    console.log(
        "[Droplet Audio] After normalization",
        {
            peak:
                normalizedPeak,

            rms:
                normalizedRms,

            gain
        }
    );


    return normalized;
}


// ============================================================
// MAIN AUDIO PROCESSOR
// ============================================================

window.DropletVoice.processAudioFile = async function (file) {

    console.log("========================================");
    console.log("Droplet Audio Processor");
    console.log("File:", file.name);
    console.log("File type:", file.type);
    console.log("File size:", file.size, "bytes");


    // --------------------------------------------------------
    // 1. READ FILE
    // --------------------------------------------------------

    const arrayBuffer =
        await file.arrayBuffer();


    // --------------------------------------------------------
    // 2. CREATE AUDIO CONTEXT
    // --------------------------------------------------------

    const AudioContextClass =
        window.AudioContext ||
        window.webkitAudioContext;


    if (!AudioContextClass) {

        throw new Error(
            "Web Audio API is not supported by this browser."
        );
    }


    const audioContext =
        new AudioContextClass();


    // --------------------------------------------------------
    // 3. DECODE M4A / MP3 / WAV / ETC.
    // --------------------------------------------------------

    console.log("Decoding audio...");


    const decodedAudio =
        await audioContext.decodeAudioData(
            arrayBuffer.slice(0)
        );


    console.log(
        "Original sample rate:",
        decodedAudio.sampleRate
    );


    console.log(
        "Channels:",
        decodedAudio.numberOfChannels
    );


    console.log(
        "Duration:",
        decodedAudio.duration
    );


    console.log(
        "Original samples:",
        decodedAudio.length
    );


    // --------------------------------------------------------
    // 4. CONVERT TO MONO
    // --------------------------------------------------------

    const numberOfChannels =
        decodedAudio.numberOfChannels;


    const length =
        decodedAudio.length;


    let mono;


    if (numberOfChannels === 1) {

        console.log(
            "Audio already mono."
        );


        mono =
            new Float32Array(
                decodedAudio.getChannelData(0)
            );

    } else {

        console.log(
            "Converting",
            numberOfChannels,
            "channels to mono..."
        );


        /*
         * IMPORTANT:
         *
         * For this diagnostic version we use the channel
         * with the strongest signal instead of blindly
         * averaging left + right.
         *
         * This avoids possible phase cancellation.
         */

        let strongestChannel = 0;
        let strongestLevel = 0;


        for (
            let channel = 0;
            channel < numberOfChannels;
            channel++
        ) {

            const data =
                decodedAudio.getChannelData(
                    channel
                );


            let level = 0;


            for (
                let i = 0;
                i < data.length;
                i++
            ) {

                level +=
                    Math.abs(
                        data[i]
                    );
            }


            level =
                level /
                data.length;


            console.log(
                "Channel",
                channel,
                "average amplitude:",
                level
            );


            if (level > strongestLevel) {

                strongestLevel =
                    level;

                strongestChannel =
                    channel;
            }
        }


        console.log(
            "Using strongest channel:",
            strongestChannel
        );


        mono =
            new Float32Array(
                decodedAudio.getChannelData(
                    strongestChannel
                )
            );
    }


    // --------------------------------------------------------
    // 5. CHECK AUDIO BEFORE RESAMPLING
    // --------------------------------------------------------

    let originalMaxAmplitude = 0;
    let originalAverageAmplitude = 0;


    for (
        let i = 0;
        i < mono.length;
        i++
    ) {

        const amplitude =
            Math.abs(
                mono[i]
            );


        originalAverageAmplitude +=
            amplitude;


        if (
            amplitude >
            originalMaxAmplitude
        ) {

            originalMaxAmplitude =
                amplitude;
        }
    }


    originalAverageAmplitude /=
        mono.length;


    console.log(
        "Before resampling - max amplitude:",
        originalMaxAmplitude
    );


    console.log(
        "Before resampling - average amplitude:",
        originalAverageAmplitude
    );


    // --------------------------------------------------------
    // 6. WHISPER SAMPLE RATE
    // --------------------------------------------------------

    const TARGET_SAMPLE_RATE =
        16000;


    // --------------------------------------------------------
    // 7. AUDIO ALREADY 16 kHz
    // --------------------------------------------------------

    if (
        decodedAudio.sampleRate ===
        TARGET_SAMPLE_RATE
    ) {

        console.log(
            "Audio already 16 kHz."
        );


        console.log(
            "Whisper samples:",
            mono.length
        );


        console.log(
            "Whisper duration:",
            mono.length /
            TARGET_SAMPLE_RATE
        );


        // ------------------------------------------------
        // STEP 16 - NORMALIZE BEFORE RETURNING
        // ------------------------------------------------

        const normalizedMono =
            normalizeSpeechAudio(
                mono
            );


        await audioContext.close();


        console.log(
            "========================================"
        );


        return normalizedMono;
    }


    // --------------------------------------------------------
    // 8. RESAMPLE TO 16 kHz
    // --------------------------------------------------------

    console.log(
        "Resampling",
        decodedAudio.sampleRate,
        "Hz →",
        TARGET_SAMPLE_RATE,
        "Hz"
    );


    const newLength =
        Math.round(

            mono.length *

            TARGET_SAMPLE_RATE /

            decodedAudio.sampleRate
        );


    const offlineContext =
        new OfflineAudioContext(

            1,

            newLength,

            TARGET_SAMPLE_RATE
        );


    const sourceBuffer =
        offlineContext.createBuffer(

            1,

            mono.length,

            decodedAudio.sampleRate
        );


    sourceBuffer.copyToChannel(
        mono,
        0
    );


    const source =
        offlineContext.createBufferSource();


    source.buffer =
        sourceBuffer;


    source.connect(
        offlineContext.destination
    );


    source.start(0);


    const renderedAudio =
        await offlineContext.startRendering();


    const renderedChannel =
        renderedAudio.getChannelData(0);


    const resampled =
        new Float32Array(
            renderedChannel.length
        );


    resampled.set(
        renderedChannel
    );


    // --------------------------------------------------------
    // 9. CHECK FINAL AUDIO
    // --------------------------------------------------------

    let maxAmplitude = 0;
    let averageAmplitude = 0;


    for (
        let i = 0;
        i < resampled.length;
        i++
    ) {

        const amplitude =
            Math.abs(
                resampled[i]
            );


        averageAmplitude +=
            amplitude;


        if (
            amplitude >
            maxAmplitude
        ) {

            maxAmplitude =
                amplitude;
        }
    }


    averageAmplitude /=
        resampled.length;


    // --------------------------------------------------------
    // 10. DEBUG INFORMATION
    // --------------------------------------------------------

    console.log(
        "Whisper sample rate:",
        TARGET_SAMPLE_RATE
    );


    console.log(
        "Whisper samples:",
        resampled.length
    );


    console.log(
        "Whisper duration:",
        resampled.length /
        TARGET_SAMPLE_RATE
    );


    console.log(
        "Maximum audio amplitude:",
        maxAmplitude
    );


    console.log(
        "Average audio amplitude:",
        averageAmplitude
    );


    // --------------------------------------------------------
    // 11. VALIDATION
    // --------------------------------------------------------

    if (
        !Number.isFinite(maxAmplitude) ||
        !Number.isFinite(averageAmplitude)
    ) {

        await audioContext.close();


        throw new Error(
            "Invalid audio samples were produced."
        );
    }


    if (
        maxAmplitude <
        0.00001
    ) {

        await audioContext.close();


        throw new Error(
            "Decoded audio is silent."
        );
    }


    // --------------------------------------------------------
    // STEP 16 - NORMALIZE AFTER RESAMPLING
    // --------------------------------------------------------

    const normalizedAudio =
        normalizeSpeechAudio(
            resampled
        );


    // --------------------------------------------------------
    // 12. CLEAN UP
    // --------------------------------------------------------

    await audioContext.close();


    console.log(
        "Audio preprocessing complete."
    );


    console.log(
        "========================================"
    );


    // --------------------------------------------------------
    // 13. SEND AUDIO TO WHISPER
    // --------------------------------------------------------

    return normalizedAudio;
};
