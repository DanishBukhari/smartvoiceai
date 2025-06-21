const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Readable } = require("stream");
const https = require("https");

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || "";
  const voiceId = "LXy8KWda5yk1Vw6sEV6w";

    const postData = JSON.stringify({
    text,
    model_id: "eleven_flash_v2.5",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  const options = {
    hostname: "api.elevenlabs.io",
    path: `/v1/text-to-speech/${voiceId}/stream`,
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const request = https.request(options, (response) => {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader('Content-Length', audioBuffer.length);
    response.pipe(res);
  });

  // const chunks = [];
  // const reqEle = https.request(options, (eleRes) => {
  //   eleRes.on('data', (chunk) => chunks.push(chunk));
  //   eleRes.on('end', () => {
  //     const audioBuffer = Buffer.concat(chunks);
  //     res.setHeader('Content-Type', 'audio/mpeg');
  //     res.setHeader('Content-Length', audioBuffer.length);
  //     res.end(audioBuffer);
  //   });
  // });

  
//   reqEle.on('error', (err) => {
//     console.error('TTS request error:', err);
//     res.status(500).end();
//   });

//   reqEle.write(postData);
//   reqEle.end();
// }

  request.on("error", (err) => {
    console.error("Request error:", err.message);
    res.status(500).end();
  });

  request.write(postData);
  request.end();
}

module.exports = { streamTTS };