import os
import json
import time
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

# Ordered list of free models to try — if one is rate-limited, fallback to the next
FREE_MODELS = [
    "qwen/qwen-2.5-7b-instruct:free",
    "google/gemma-3-12b-it:free",
    "google/gemma-3-4b-it:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "microsoft/phi-3-mini-128k-instruct:free",
]

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

    # Validate and log messages before sending to OpenRouter
    if not isinstance(user_messages, list) or not all(isinstance(m, dict) and 'role' in m and 'content' in m for m in user_messages):
        return jsonify({"error": "Invalid 'messages' format. Must be an array of objects with 'role' and 'content'."}), 400

    print("Validated messages:", json.dumps(user_messages, indent=2))

    print("Sending payload to OpenRouter:", json.dumps(messages, indent=2))

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "HTTP-Referer": "http://localhost:5000",
        "X-OpenRouter-Title": "CareerMind Agent"
    }

    # Proxy the streaming response back to the client — tries each free model in order
    def generate():
        last_error = "Unknown error"
        for model in FREE_MODELS:
            payload = {
                "model": model,
                "max_tokens": 1024,
                "stream": True,
                "messages": messages
            }
            try:
                with requests.post(OPENROUTER_URL, headers=headers, json=payload, stream=True, timeout=30) as resp:
                    if resp.status_code == 429:
                        # Rate limited — wait briefly then try the next model
                        print(f"[429] Model {model} rate-limited, trying next...")
                        last_error = f"Model {model} rate-limited (429)"
                        time.sleep(1)
                        continue
                    resp.raise_for_status()
                    print(f"[OK] Using model: {model}")
                    has_yielded = False
                    for line in resp.iter_lines():
                        if line:
                            decoded_line = line.decode('utf-8')
                            yield decoded_line + '\n\n'
                            has_yielded = True
                    
                    if has_yielded:
                        print(f"[DONE] Stream finished for {model}")
                        return
                    else:
                        print(f"[WARN] Empty stream for {model}, trying next...")
                        continue
            except requests.exceptions.RequestException as e:
                last_error = str(e)
                print(f"[ERR] {model}: {e}")
                time.sleep(1)
                continue

        # All models failed — send a friendly error downstream
        error_msg = json.dumps({"choices": [{"delta": {"content": f"⚠️ All free models are currently rate-limited. Please wait a minute and try again.\n\n({last_error})"}}]})
        yield f"data: {error_msg}\n\n"
        yield "data: [DONE]\n\n"

    # Important: return as text/event-stream so the frontend parses it correctly
    return Response(generate(), mimetype='text/event-stream')

@app.route('/api/test-vision', methods=['GET', 'POST'])
def test_vision():
    if not API_KEY:
        return jsonify({"error": "Missing API Key on server. Check .env file."}), 500

    response = requests.post(
      url="https://openrouter.ai/api/v1/chat/completions",
      headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-OpenRouter-Title": "CareerMind Agent"
      },
      data=json.dumps({
        "model": "google/gemma-3-4b-it:free",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "What is in this image?"
              },
              {
                "type": "image_url",
                "image_url": {
                  "url": "https://live.staticflickr.com/3851/14825276609_098cac593d_b.jpg"
                }
              }
            ]
          }
        ]
      })
    )
    return jsonify(response.json())

if __name__ == '__main__':
    app.run(port=5000, debug=True)
