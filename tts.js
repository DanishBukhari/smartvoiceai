const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Readable } = require("stream");

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || "";
  const voiceId = "LXy8KWda5yk1Vw6sEV6w"; // Replace with your voice ID

  try {
    // Use the stream() method for real-time audio streaming
    const stream = await client.textToSpeech.stream(voiceId, {
      text,
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });

    // Check if the returned object is a valid stream
    if (!(stream instanceof Readable)) {
      throw new Error("Invalid stream object returned from ElevenLabs");
    }

    // Set headers for audio streaming
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    // Pipe the stream to the response
    stream.pipe(res);

    // Handle stream errors
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      res.status(500).end();
    });

    // Log when streaming completes
    stream.on("end", () => {
      console.log("Audio stream ended");
      res.end();
    });
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).end();
  }
}

module.exports = { streamTTS };