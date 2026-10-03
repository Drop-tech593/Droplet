// Droplet Voice-to-Text
// Model selection and device routing

window.DropletVoice = window.DropletVoice || {};

window.DropletVoice.selectModel = async function () {

    const capabilities =
        await window.DropletVoice.detectCapabilities();

    let configuration = {
        engine: "wasm",
        model: "base",
        device: "cpu",
        reason: "Default compatibility mode"
    };

    // Prefer WebGPU when available
    if (capabilities.webGPU) {

        configuration = {
            engine: "transformers",
            model: "small",
            device: "webgpu",
            reason: "WebGPU available"
        };

    }

    // Lower-end CPU fallback
    else if (
        capabilities.cpuThreads <= 2 ||
        (capabilities.memoryGB && capabilities.memoryGB <= 4)
    ) {

        configuration = {
            engine: "wasm",
            model: "tiny",
            device: "cpu",
            reason: "Lower-resource device"
        };

    }

    console.log(
        "Droplet Voice Engine - Selected configuration"
    );

    console.table(configuration);

    return configuration;
};
