// ============================================================
// DROPLET VOICE-TO-TEXT
// Audio Processor
//
// Purpose:
// 1. Read uploaded audio
// 2. Decode M4A / MP3 / WAV etc.
// 3. Convert stereo to mono
// 4. Resample audio to 16,000 Hz
// 5. Return Float32Array for Whisper
// ============================================================

window.DropletVoice = window.DropletVoice || {};


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


        await audioContext.close();


        console.log(
            "========================================"
        );


        return mono;
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

    return resampled;
};
