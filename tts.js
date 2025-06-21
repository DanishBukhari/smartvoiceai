const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Readable } = require("stream");
const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || "";
  const voiceId = "LXy8KWda5yk1Vw6sEV6w"; // Your voice ID

  try {
    // Get the audio data from ElevenLabs
    const result = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });

    // Log the result type for debugging
    console.log("Result type:", typeof result, result instanceof Buffer, result instanceof Readable);

    // Handle different possible return types
    if (result instanceof Buffer) {
      // If it’s a Buffer, send it directly
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", result.length);
      res.end(result);
    } else if (result instanceof Readable) {
      // If it’s a Readable stream, pipe it to the response
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Transfer-Encoding", "chunked");
      result.pipe(res);
    } else if (result && typeof result === "object" && result.body) {
      // If it’s an object with a body property (e.g., a fetch Response), extract the stream
      const stream = result.body;
      if (stream instanceof Readable) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Transfer-Encoding", "chunked");
        stream.pipe(res);
      } else {
        throw new Error("Invalid stream object");
      }
    } else {
      // If none of the above, throw an error
      throw new Error("Unexpected result type from ElevenLabs");
    }
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).end();
  }
}

module.exports = { streamTTS };