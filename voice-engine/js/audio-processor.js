// Droplet Voice-to-Text
// Local audio decoding and preprocessing

window.DropletVoice = window.DropletVoice || {};

window.DropletVoice.processAudioFile = async function(file) {

    console.log("Droplet: decoding audio:", file.name);

    const arrayBuffer = await file.arrayBuffer();

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


    // -----------------------------------------
    // MIX AUDIO TO MONO
    // -----------------------------------------

    const length =
        decodedAudio.length;

    const mono =
        new Float32Array(length);

    for (
        let channel = 0;
        channel < decodedAudio.numberOfChannels;
        channel++
    ) {

        const channelData =
            decodedAudio.getChannelData(channel);

        for (
            let i = 0;
            i < length;
            i++
        ) {

            mono[i] +=
                channelData[i] /
                decodedAudio.numberOfChannels;
        }
    }


    // -----------------------------------------
    // RESAMPLE TO WHISPER'S 16 kHz
    // -----------------------------------------

    const TARGET_SAMPLE_RATE = 16000;

    if (
        decodedAudio.sampleRate ===
        TARGET_SAMPLE_RATE
    ) {

        await audioContext.close();

        return mono;
    }


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


    const buffer =
        offlineContext.createBuffer(
            1,
            mono.length,
            decodedAudio.sampleRate
        );


    buffer.copyToChannel(
        mono,
        0
    );


    const source =
        offlineContext.createBufferSource();

    source.buffer =
        buffer;

    source.connect(
        offlineContext.destination
    );

    source.start();


    const rendered =
        await offlineContext
            .startRendering();


    const resampled =
        new Float32Array(
            rendered.getChannelData(0)
        );


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


    await audioContext.close();


    return resampled;
};
