const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Readable } = require("stream");
const https = require("https");

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || "";
  const voiceId = "LXy8KWda5yk1Vw6sEV6w";
  const options = {
    hostname: "api.elevenlabs.io",
    path: `/v1/text-to-speech/${voiceId}/stream`,
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
  };
  const postData = JSON.stringify({
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  const request = https.request(options, (response) => {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    response.pipe(res);
  });

  request.on("error", (err) => {
    console.error("Request error:", err.message);
    res.status(500).end();
  });

  request.write(postData);
  request.end();
}

module.exports = { streamTTS };