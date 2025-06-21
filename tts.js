const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Readable } = require("stream");
const https = require("https");

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || "";
  const voiceId = "LXy8KWda5yk1Vw6sEV6w"; // Your voice ID

  try {
    // Attempt to use the SDK's stream() method
    const result = await client.textToSpeech.stream(voiceId, {
      text,
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });

    // Log the result for debugging
    console.log("Result type:", typeof result);
    console.log("Is Readable:", result instanceof Readable);
    console.log("Has body property:", !!result.body);
    console.log("Result properties:", Object.keys(result));

    // Handle different possible return types
    let stream;
    if (result instanceof Readable) {
      stream = result; // Direct Readable stream
    } else if (result && result.body) {
      stream = result.body; // Extract stream from a Response-like object
      if (!(stream instanceof Readable)) {
        throw new Error("Body is not a Readable stream");
      }
    } else {
      throw new Error("Unexpected result type from ElevenLabs stream()");
    }

    // Set headers and pipe the stream
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("Stream error:", err.message);
      res.status(500).end();
    });

    stream.on("end", () => {
      console.log("Audio stream completed");
      res.end();
    });
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).end();

    // Fallback: Direct HTTP request if SDK fails consistently
    console.log("Falling back to direct HTTP request...");
    const options = {
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${voiceId}/stream`, // Note the /stream endpoint
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
      if (response.statusCode !== 200) {
        console.error(`HTTP error: ${response.statusCode}`);
        res.status(500).end();
        return;
      }
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
}

module.exports = { streamTTS };