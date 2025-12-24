const browserAPI = (typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null));

const tc = {
  settings: {
    logLevel: 4,
    debugMode: false
  },
  vars: {
    dB: 0,
    mono: false,
    audioCtx: undefined,
    gainNode: undefined,
    isBlocked: false
  }
};

const logTypes = ["ERROR", "WARNING", "INFO", "DEBUG"];
function log(msg, level = 4) {
  if (tc.settings.logLevel >= level) console.log(`[VolumeControl] ${logTypes[level-2]}: ${msg}`);
}

if (browserAPI) {
    browserAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (tc.vars.isBlocked) return;
        switch (msg.command) {
            case "checkExclusion":
                sendResponse({ status: "active" });
                break;
            case "setVolume":
                tc.vars.dB = msg.dB;
                applyState();
                sendResponse({});
                break;
            case "getVolume":
                sendResponse({ response: tc.vars.dB });
                break;
            case "setMono":
                tc.vars.mono = msg.mono;
                applyState();
                sendResponse({});
                break;
            case "getMono":
                sendResponse({ response: tc.vars.mono });
                break;
        }
        return true;
    });
}

function getGainValue(dB) {
    const n = Number(dB);
    if (Number.isNaN(n)) return 1.0;
    return Math.pow(10, n / 20);
}

function applyState() {
    const audioCtx = tc.vars.audioCtx;
    const gainNode = tc.vars.gainNode;
    if (!gainNode || !audioCtx) return;

    const targetGain = getGainValue(tc.vars.dB);
    const now = audioCtx.currentTime;

    gainNode.gain.value = targetGain;

    if (audioCtx.state === 'running') {
        try {
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(targetGain, now);
        } catch (e) {
            if (tc.settings.debugMode) log(`applyState schedule failed: ${e.message}`, 2);
        }
    }

    if (tc.vars.mono) {
        gainNode.channelCountMode = "explicit";
        gainNode.channelCount = 1;
    } else {
        gainNode.channelCountMode = "max";
        gainNode.channelCount = 2;
    }
} 

function createGainNode() {
    if (!tc.vars.audioCtx) return;

    if (!tc.vars.gainNode) {
        tc.vars.gainNode = tc.vars.audioCtx.createGain();
        tc.vars.gainNode.channelInterpretation = "speakers";
    }
    applyState();
}

function connectOutput(element) {
    if (element.dataset.vcHooked === "true") return;

    if (!tc.vars.audioCtx) {
        tc.vars.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        tc.vars.audioCtx.onstatechange = () => {
            if (tc.vars.audioCtx.state === 'running') applyState();
        };
    }

    if (!tc.vars.gainNode) createGainNode();

    try {
        log(`Attempting hook: ${element.tagName}`, 4);
        let source = null;

        if (typeof element.wrappedJSObject !== 'undefined') {
            try {
                source = tc.vars.audioCtx.createMediaElementSource(element.wrappedJSObject);
            } catch (e) {
                log("Unwrap failed, trying direct...", 3);
            }
        }

        if (!source) source = tc.vars.audioCtx.createMediaElementSource(element);

        source.connect(tc.vars.gainNode);
        tc.vars.gainNode.connect(tc.vars.audioCtx.destination);

        element.dataset.vcHooked = "true";
        applyState();

        if (tc.settings.debugMode) element.style.border = "2px solid #00ff00";
        else element.style.border = "";
        log("Hook Success!", 4);

    } catch (e) {
        if (tc.settings.debugMode) element.style.border = "5px solid red";
    }
} 

function init() {
    if (document.body.classList.contains("vc-init")) return;

    for (const el of document.querySelectorAll("audio, video")) connectOutput(el);

    new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const n of m.addedNodes) {
                if (n.nodeType === 1) {
                    if (n.tagName === 'AUDIO' || n.tagName === 'VIDEO') connectOutput(n);
                    else if (n.querySelectorAll) for (const el of n.querySelectorAll('audio, video')) connectOutput(el);
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', () => {
        if (tc.vars.audioCtx && tc.vars.audioCtx.state === 'suspended') tc.vars.audioCtx.resume().then(applyState);
    }, { passive: true });

    document.body.classList.add("vc-init");
} 

function extractRootDomain(url) {
    if (!url) return "";
    let domain = url.replace(/^(https?|ftp):\/\/(www\.)?/, '');
    domain = domain.split('/')[0].split(':')[0];
    return domain.toLowerCase();
} 

function start() {
    if (!browserAPI) return;

    browserAPI.storage.local.get({ fqdns: [], whitelist: [], whitelistMode: false, siteSettings: {}, debugMode: false }, (data) => {
        if (browserAPI.runtime.lastError) return;

        if (data.debugMode !== undefined) tc.settings.debugMode = data.debugMode;

        const currentDomain = extractRootDomain(window.location.href);

        let blocked = false;
        if (data.whitelistMode) {
            if (!data.whitelist.some(d => currentDomain.includes(d))) blocked = true;
        } else {
            if (data.fqdns.some(d => currentDomain.includes(d))) blocked = true;
        }

        if (blocked) {
            tc.vars.isBlocked = true;
            return;
        }

        if (data.siteSettings && data.siteSettings[currentDomain]) {
            const s = data.siteSettings[currentDomain];
            if (s.volume !== undefined) tc.vars.dB = parseInt(s.volume, 10) || 0;
            if (s.mono !== undefined) tc.vars.mono = s.mono;
        }

        init();
    });
}

if (document.readyState === "loading") {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
} 