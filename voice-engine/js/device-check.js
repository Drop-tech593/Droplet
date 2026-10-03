// Droplet Voice-to-Text
// Device capability detection

async function detectVoiceCapabilities() {
    const capabilities = {
        webAssembly: typeof WebAssembly !== "undefined",
        webWorkers: typeof Worker !== "undefined",
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        crossOriginIsolated: window.crossOriginIsolated === true,
        webGPU: "gpu" in navigator,
        cpuThreads: navigator.hardwareConcurrency || 1,
        memoryGB: navigator.deviceMemory || null
    };

    console.log("Droplet Voice Engine - Device Capabilities");
    console.table(capabilities);

    return capabilities;
}

window.DropletVoice = window.DropletVoice || {};
window.DropletVoice.detectCapabilities = detectVoiceCapabilities;
