// Put all numbers that can be tuned in this simulation here.
const config = {
    maxAngle: 90,
    timeConstant: 0.6,
    noiseDegrees: 2,
    graphSeconds: 10,
    graphSampleSeconds: 0.05,
    kp: 1.2,
    ki: 0.2,
    kd: 0.15,
    integralLimit: 40,
    derivativeFilterTime: 0.15,
    disturbanceDegrees: 15,
    flapFrequency: 0.5,
    flapAmplitude: 30,
    flapCenter: 45
};

const pressureDisplay = document.getElementById("pressureValue");
const angleDisplay = document.getElementById("angleValue");
const measuredDisplay = document.getElementById("measuredValue");
const targetDisplay = document.getElementById("targetValue");
const noiseDisplay = document.getElementById("noiseValue");
const pressureSlider = document.getElementById("pressureSlider");
const targetSlider = document.getElementById("targetSlider");
const noiseSlider = document.getElementById("noiseSlider");
const kpSlider = document.getElementById("kpSlider");
const kiSlider = document.getElementById("kiSlider");
const kdSlider = document.getElementById("kdSlider");
const kpDisplay = document.getElementById("kpValue");
const kiDisplay = document.getElementById("kiValue");
const kdDisplay = document.getElementById("kdValue");
const flappingToggle = document.getElementById("flappingToggle");
const frequencySlider = document.getElementById("frequencySlider");
const amplitudeSlider = document.getElementById("amplitudeSlider");
const frequencyDisplay = document.getElementById("frequencyValue");
const amplitudeDisplay = document.getElementById("amplitudeValue");
const disturbanceButton = document.getElementById("disturbanceButton");
const resetButton = document.getElementById("resetButton");
const canvas = document.getElementById("simulationCanvas");
const ctx = canvas.getContext("2d");
const graphCanvas = document.getElementById("graphCanvas");
const graphCtx = graphCanvas.getContext("2d");

let pressure = 0;
let angle = 0;
let targetAngle = 0;
let measuredAngle = 0;
let graphData = [];
let lastGraphSampleTime = 0;
let lastTime = performance.now();
let controlMode = "manual";
let integral = 0;
let previousError = 0;
let filteredDerivative = 0;

// Converts pressure from 0-100 kPa into an angle from 0-90 degrees.
function pressureToAngle(p) {
    return config.maxAngle * (p / 100);
}

// Draws the flexible wing shape on the main simulation canvas.
function drawSimulation(currentAngle) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#101b2b";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#30445c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.7);
    ctx.lineTo(width, height * 0.7);
    ctx.stroke();

    const baseX = width * 0.18;
    const baseY = height * 0.7;
    const length = 430;
    const angleRadians = currentAngle * Math.PI / 180;
    const tipX = baseX + length * Math.cos(angleRadians);
    const tipY = baseY - length * Math.sin(angleRadians);

    ctx.lineCap = "round";
    ctx.strokeStyle = "#5eead4";
    ctx.lineWidth = 44;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);

    const bendX = baseX + (length * 0.55) * Math.cos(angleRadians * 0.55);
    const bendY = baseY - (length * 0.55) * Math.sin(angleRadians * 0.55);
    ctx.quadraticCurveTo(bendX, bendY, tipX, tipY);
    ctx.stroke();

    ctx.fillStyle = "#1b3348";
    ctx.fillRect(baseX - 30, baseY - 10, 60, 74);
}

// Draws the target, true, and noisy measured angles over the last 10 seconds.
function drawGraph() {
    const width = graphCanvas.width;
    const height = graphCanvas.height;
    const padding = { left: 45, right: 15, top: 15, bottom: 30 };
    graphCtx.clearRect(0, 0, width, height);
    graphCtx.fillStyle = "#101b2b";
    graphCtx.fillRect(0, 0, width, height);

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    graphCtx.strokeStyle = "#30445c";
    graphCtx.lineWidth = 1;
    graphCtx.font = "12px Arial";
    graphCtx.fillStyle = "#aab9cb";

    for (let value = 0; value <= config.maxAngle; value += 30) {
        const y = padding.top + plotHeight - (value / config.maxAngle) * plotHeight;
        graphCtx.beginPath();
        graphCtx.moveTo(padding.left, y);
        graphCtx.lineTo(width - padding.right, y);
        graphCtx.stroke();
        graphCtx.fillText(value + "°", 8, y + 4);
    }

    graphCtx.fillText("-10 s", padding.left, height - 8);
    graphCtx.fillText("now", width - padding.right - 28, height - 8);

    drawGraphLine("target", "#facc15", padding, plotWidth, plotHeight);
    drawGraphLine("true", "#5eead4", padding, plotWidth, plotHeight);
    drawGraphLine("measured", "#fb7185", padding, plotWidth, plotHeight);
}

// Draws one coloured line from the saved graph samples.
function drawGraphLine(propertyName, colour, padding, plotWidth, plotHeight) {
    if (graphData.length < 2) return;

    const newestTime = graphData[graphData.length - 1].time;
    graphCtx.strokeStyle = colour;
    graphCtx.lineWidth = 2;
    graphCtx.beginPath();

    graphData.forEach((sample, index) => {
        const secondsAgo = newestTime - sample.time;
        const x = padding.left + plotWidth - (secondsAgo / config.graphSeconds) * plotWidth;
        const y = padding.top + plotHeight - (sample[propertyName] / config.maxAngle) * plotHeight;
        if (index === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    });

    graphCtx.stroke();
}

// Updates the wing target when flapping mode uses a sine wave.
function updateFlappingTarget(nowSeconds) {
    if (!flappingToggle.checked) return;

    const radians = 2 * Math.PI * config.flapFrequency * nowSeconds;
    targetAngle = config.flapCenter + config.flapAmplitude * Math.sin(radians);
    targetAngle = Math.max(0, Math.min(config.maxAngle, targetAngle));
    targetSlider.value = Math.round(targetAngle);
    targetDisplay.textContent = Math.round(targetAngle) + "°";
}

// Calculates PID pressure from the target minus the noisy measured angle.
function calculatePidPressure(dt) {
    const error = targetAngle - measuredAngle;
    const rawDerivative = dt > 0 ? (error - previousError) / dt : 0;
    const derivativeMix = dt / (dt + config.derivativeFilterTime);
    filteredDerivative += (rawDerivative - filteredDerivative) * derivativeMix;
    previousError = error;

    if (dt > 0) {
        const nextIntegral = integral + error * dt;
        const nextIntegralLimited = Math.max(-config.integralLimit, Math.min(config.integralLimit, nextIntegral));

        const proposedPressure = config.kp * error
            + config.ki * nextIntegralLimited
            + config.kd * filteredDerivative;

        const wouldBeSaturatedHigh = proposedPressure > 100 && error > 0;
        const wouldBeSaturatedLow = proposedPressure < 0 && error < 0;
        if (!wouldBeSaturatedHigh && !wouldBeSaturatedLow) {
            integral = nextIntegralLimited;
        }
    }

    const pidPressure = config.kp * error
        + config.ki * integral
        + config.kd * filteredDerivative;
    return Math.max(0, Math.min(100, pidPressure));
}

// Runs one animation step using real elapsed time in seconds.
function animate(now) {
    const dt = Math.max(0, (now - lastTime) / 1000);
    lastTime = now;

    updateFlappingTarget(now / 1000);

    if (controlMode === "auto") {
        pressure = calculatePidPressure(dt);
        pressureDisplay.textContent = Math.round(pressure) + " kPa";
        pressureSlider.value = Math.round(pressure);
    }

    const actuatorTarget = pressureToAngle(pressure);
    angle += (actuatorTarget - angle) * (1 - Math.exp(-dt / config.timeConstant));
    measuredAngle = angle + (Math.random() * 2 - 1) * config.noiseDegrees;
    measuredAngle = Math.max(0, Math.min(config.maxAngle, measuredAngle));

    angleDisplay.textContent = Math.round(angle) + "°";
    measuredDisplay.textContent = Math.round(measuredAngle) + "°";
    drawSimulation(angle);

    if ((now - lastGraphSampleTime) / 1000 >= config.graphSampleSeconds) {
        graphData.push({
            time: now / 1000,
            target: targetAngle,
            true: angle,
            measured: measuredAngle
        });

        const oldestAllowedTime = now / 1000 - config.graphSeconds;
        graphData = graphData.filter((sample) => sample.time >= oldestAllowedTime);
        lastGraphSampleTime = now;
        drawGraph();
    }
    requestAnimationFrame(animate);
}

pressureSlider.addEventListener("input", () => {
    pressure = Number(pressureSlider.value);
    pressureDisplay.textContent = pressure + " kPa";
});

targetSlider.addEventListener("input", () => {
    targetAngle = Number(targetSlider.value);
    targetDisplay.textContent = targetAngle + "°";
});

noiseSlider.addEventListener("input", () => {
    config.noiseDegrees = Number(noiseSlider.value);
    noiseDisplay.textContent = config.noiseDegrees + "°";
});

document.querySelectorAll('input[name="controlMode"]').forEach((radioButton) => {
    radioButton.addEventListener("change", () => {
        controlMode = radioButton.value;
        pressureSlider.disabled = controlMode === "auto";
        integral = 0;
        previousError = 0;
        filteredDerivative = 0;
    });
});

kpSlider.addEventListener("input", () => {
    config.kp = Number(kpSlider.value);
    kpDisplay.textContent = config.kp.toFixed(1);
});

kiSlider.addEventListener("input", () => {
    config.ki = Number(kiSlider.value);
    kiDisplay.textContent = config.ki.toFixed(2);
});

kdSlider.addEventListener("input", () => {
    config.kd = Number(kdSlider.value);
    kdDisplay.textContent = config.kd.toFixed(2);
});

frequencySlider.addEventListener("input", () => {
    config.flapFrequency = Number(frequencySlider.value);
    frequencyDisplay.textContent = config.flapFrequency.toFixed(1) + " Hz";
});

amplitudeSlider.addEventListener("input", () => {
    config.flapAmplitude = Number(amplitudeSlider.value);
    amplitudeDisplay.textContent = config.flapAmplitude + "°";
});

flappingToggle.addEventListener("change", () => {
    targetSlider.disabled = flappingToggle.checked;
});

disturbanceButton.addEventListener("click", () => {
    const direction = Math.random() > 0.5 ? 1 : -1;
    angle = Math.max(0, Math.min(config.maxAngle, angle + direction * config.disturbanceDegrees));
    measuredAngle = angle;
});

resetButton.addEventListener("click", () => {
    pressureSlider.value = 0;
    pressure = 0;
    angle = 0;
    measuredAngle = 0;
    targetAngle = 0;
    targetSlider.value = 0;
    targetDisplay.textContent = "0°";
    pressureDisplay.textContent = "0 kPa";
    integral = 0;
    previousError = 0;
    filteredDerivative = 0;
});

requestAnimationFrame(animate);