import os
import json
import requests
from flask import Flask, request, Response, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
# Enable CORS so the React app running on a different port can communicate with this API
CORS(app)

# Move the system prompt from the frontend to the backend for security
SYSTEM_PROMPT = """You are CareerMind, a highly intelligent career advisory agent.
Your ONLY output format is to FIRST provide your detected intent on a single line starting with: "INTENT: [INTENT_NAME]", followed immediately by your detailed advisory response on the next line.
Allowed INTENT_NAMEs: RESUME, JOB_SEARCH, INTERVIEW, CORPORATE, TECHNICAL, GENERAL.
Provide brilliant, actionable, hyper-specific career guidance. Never break character."""

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Try to get the API key using either of these variable names
API_KEY = os.getenv("VITE_ANTHROPIC_API_KEY") or os.getenv("OPENROUTER_API_KEY")

@app.route('/api/chat', methods=['POST'])
def chat():
    if not API_KEY:
        return jsonify({"error": "Missing API Key on server. Check .env file."}), 500

    data = request.json
    user_messages = data.get('messages', [])
    
    # Prepend our system setup
    messages = [
        { "role": "user", "content": SYSTEM_PROMPT },
        { "role": "assistant", "content": "INTENT: GENERAL\nUnderstood. I am CareerMind, ready to assist." }
    ]
    messages.extend(user_messages)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "HTTP-Referer": "http://localhost:5000",
        "X-OpenRouter-Title": "CareerMind Agent"
    }

    payload = {
        "model": "google/gemma-3-4b-it:free",
        "max_tokens": 1024,
        "stream": True,
        "messages": messages
    }

    # Proxy the streaming response back to the client
    def generate():
        try:
            with requests.post(OPENROUTER_URL, headers=headers, json=payload, stream=True) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if line:
                        yield line.decode('utf-8') + '\n\n'
        except requests.exceptions.RequestException as e:
            # Send an error event to the stream if it fails
            error_msg = json.dumps({"choices": [{"delta": {"content": f"\\n\\nServer Error: {str(e)}"}}]})
            yield f"data: {error_msg}\n\n"
            yield "data: [DONE]\n\n"

    # Important: return as text/event-stream so the frontend parses it correctly
    return Response(generate(), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(port=5000, debug=True)
