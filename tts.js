const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || "";
  const voiceId = "LXy8KWda5yk1Vw6sEV6w"; // Your voice ID

  try {
    // Get the audio stream from ElevenLabs
    const response = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });

    // Extract the readable stream (assuming response is a fetch-like Response object)
    const stream = response.body;

    // Verify that we have a valid stream
    if (!stream || typeof stream.pipe !== "function") {
      throw new Error("Invalid stream object returned from ElevenLabs");
    }

    // Set headers for streaming audio
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    // Pipe the stream directly to the response
    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("Stream error:", err);
      res.status(500).end();
    });

    stream.on("end", () => {
      console.log("Stream ended");
      res.end();
    });
  } catch (err) {
    console.error('TTS error:', err.message);
    if (err.response && err.response.data) {
      let errorBody = '';
      err.response.data.on('data', (chunk) => (errorBody += chunk));
      err.response.data.on('end', () => {
        console.error('Error details:', errorBody);
      });
    }
    res.status(500).end();
  }
}

module.exports = { streamTTS };