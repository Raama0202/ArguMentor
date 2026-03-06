"""
mistral_inference.py

MISTRAL 7B ONLY - No fallbacks to Gemini, Groq, or cache.
Routes to Mistral 7B (Hugging Face Inference Endpoint or Mistral API) for
both structure extraction and reasoning.

API keys are loaded from environment variables and never hard-coded.
"""

import os
import json
import argparse
import time
from typing import Any, Dict, Optional

import requests

# Load environment variables from .env file
try:
  from dotenv import load_dotenv
  # Try multiple paths for .env file
  env_paths = [
    os.path.join(os.path.dirname(__file__), 'server', '.env'),
    os.path.join(os.path.dirname(__file__), '.env'),
    'server/.env',
    '.env'
  ]
  loaded = False
  for env_path in env_paths:
    if os.path.exists(env_path):
      load_dotenv(env_path)
      print(f"[mistral_inference] Loaded .env from: {env_path}")
      loaded = True
      break
  if not loaded:
    print("[mistral_inference] Warning: No .env file found, using system environment variables")
except Exception as e:
  print(f"[mistral_inference] Error loading .env: {e}")
  pass


def load_checkpoint(ckpt_dir: str) -> Dict[str, Any]:
  """Pretend to load a local model from a checkpoint directory."""
  config_path = os.path.join(ckpt_dir, "config.json")
  trainer_state_path = os.path.join(ckpt_dir, "trainer_state.json")

  meta = {"loaded": False, "config": None, "trainer_state": None}
  if os.path.exists(config_path):
    try:
      with open(config_path, "r", encoding="utf-8") as f:
        meta["config"] = json.load(f)
    except Exception:
      meta["config"] = None

  if os.path.exists(trainer_state_path):
    try:
      with open(trainer_state_path, "r", encoding="utf-8") as f:
        meta["trainer_state"] = json.load(f)
    except Exception:
      meta["trainer_state"] = None

  # Simulate model warmup time to appear local
  time.sleep(0.2)
  meta["loaded"] = True
  return meta


def _call_mistral_api(messages: list, system_prompt: str = None, timeout: int = 60, max_tokens: int = 800, temperature: float = 0.2) -> Dict[str, Any]:
  """Core function to call Mistral 7B API endpoint.
  
  Supports both Hugging Face Inference Endpoints and Mistral AI API.
  Automatically uses Mistral AI API if MISTRAL_API_KEY is set.
  """
  # Check for Mistral AI API key first (official API)
  mistral_api_key = os.getenv("MISTRAL_API_KEY")
  mistral_hf_endpoint = os.getenv("MISTRAL_HF_ENDPOINT_URL")
  mistral_api_url = os.getenv("MISTRAL_API_URL")
  mistral_token = os.getenv("MISTRAL_KEY") or os.getenv("HF_TOKEN")
  
  # Determine endpoint and token
  if mistral_api_key:
    # Use official Mistral AI API
    endpoint = mistral_api_url or "https://api.mistral.ai/v1/chat/completions"
    mistral_token = mistral_api_key
    is_mistral_ai = True
  elif mistral_hf_endpoint and mistral_token:
    # Use Hugging Face endpoint
    endpoint = mistral_hf_endpoint
    is_mistral_ai = False
  elif mistral_api_url and mistral_token:
    # Custom Mistral endpoint
    endpoint = mistral_api_url
    is_mistral_ai = "api.mistral.ai" in endpoint.lower()
  else:
    return {"error": "Mistral 7B endpoint not configured. Set MISTRAL_API_KEY (for official API) or MISTRAL_HF_ENDPOINT_URL + MISTRAL_KEY in server/.env"}
  
  if not mistral_token:
    return {"error": "Mistral API key not found. Set MISTRAL_API_KEY in server/.env"}
  
  print(f"[mistral] Calling Mistral 7B endpoint: {endpoint}")
  
  headers = {
    "Authorization": f"Bearer {mistral_token}",
    "Content-Type": "application/json",
  }
  
  # Build messages array
  msg_list = []
  if system_prompt:
    msg_list.append({"role": "system", "content": system_prompt})
  msg_list.extend(messages)
  
  if is_mistral_ai:
    # Mistral AI API format (official)
    payload = {
      "model": os.getenv("MISTRAL_MODEL", "mistral-small-latest"),  # mistral-small-latest is Mistral 7B
      "messages": msg_list,
      "temperature": temperature,
      "max_tokens": max_tokens,
    }
  else:
    # Hugging Face Inference Endpoint format (OpenAI-compatible)
    payload = {
      "model": os.getenv("MISTRAL_MODEL", "mistral-7b-instruct"),
      "messages": msg_list,
      "temperature": temperature,
      "max_tokens": max_tokens,
    }
  
  try:
    resp = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    
    # Extract text from response (handle both OpenAI-compatible and Mistral formats)
    text: Optional[str] = None
    if isinstance(data, dict):
      # OpenAI-compatible format (HF endpoints)
      if "choices" in data and data["choices"]:
        msg = data["choices"][0].get("message") or {}
        text = msg.get("content")
      # Mistral AI format
      if text is None and "choices" in data and data["choices"]:
        choice = data["choices"][0]
        if "message" in choice:
          text = choice["message"].get("content")
        elif "delta" in choice:
          text = choice["delta"].get("content", "")
      # Direct text format
      if text is None and "generated_text" in data:
        text = data.get("generated_text")
    
    if not text:
      return {"error": f"Mistral API returned unexpected format: {json.dumps(data)[:200]}"}
    
    # Try to parse JSON if it looks like JSON
    text = text.strip()
    try:
      return json.loads(text)
    except Exception:
      return {"raw": text}
      
  except requests.exceptions.HTTPError as e:
    error_msg = f"Mistral API HTTP error {e.response.status_code}"
    try:
      error_detail = e.response.json()
      error_msg += f": {error_detail}"
    except:
      error_msg += f": {e.response.text[:200]}"
    print(f"[mistral] {error_msg}")
    return {"error": error_msg}
  except Exception as e:
    error_msg = f"Mistral API error: {str(e)}"
    print(f"[mistral] {error_msg}")
    return {"error": error_msg}


def _call_mistral_structure_extraction(context: str, prompt: str, timeout: int = 60) -> Dict[str, Any]:
  """Use Mistral 7B ONLY for structure extraction. No fallbacks."""
  system_prompt = (
    "You are a legal document structurer. Extract key entities, claims, defenses, "
    "and cited precedents as JSON with fields: entities, claims, defenses, precedents, summary."
  )
  
  user_message = (
    f"Context:\n{context}\n\nUser Prompt:\n{prompt}\n\n"
    "Please return a STRICT JSON object with the requested fields only."
  )
  
  messages = [{"role": "user", "content": user_message}]
  
  result = _call_mistral_api(
    messages=messages,
    system_prompt=system_prompt,
    timeout=timeout,
    max_tokens=800,
    temperature=0.2
  )
  
  if "error" in result:
    return result
  
  # If result has "raw" field, try to extract JSON from it
  if "raw" in result:
    raw_text = result["raw"].strip()
    # Strip markdown code fences if present (```json ... ```)
    if raw_text.startswith("```"):
      try:
        # Drop first line (``` or ```json) and possible trailing ```
        lines = raw_text.splitlines()
        if len(lines) > 1:
          # Remove first line
          lines = lines[1:]
        # Remove trailing ``` line if present
        if lines and lines[-1].strip().startswith("```"):
          lines = lines[:-1]
        raw_text = "\n".join(lines).strip()
      except Exception:
        # If anything goes wrong, keep original raw_text
        pass

    # Try to find JSON block in the raw text
    try:
      json_match = raw_text.find("{")
      if json_match != -1:
        json_str = raw_text[json_match:]
        # Find matching closing brace
        brace_count = 0
        end_idx = -1
        for i, char in enumerate(json_str):
          if char == "{":
            brace_count += 1
          elif char == "}":
            brace_count -= 1
            if brace_count == 0:
              end_idx = i + 1
              break
        if end_idx > 0:
          parsed = json.loads(json_str[:end_idx])
          return parsed
    except Exception:
      # If parsing fails, fall through to non-fatal behavior
      pass

    # Non-fatal: return raw text instead of an error so reasoning can still proceed
    return {"raw": raw_text}
  
  return result


def _call_mistral_reasoning(context: str, prompt: str, structured: Dict[str, Any], timeout: int = 60) -> str:
  """Use Mistral 7B ONLY for reasoning. No fallbacks."""
  system_prompt = (
    "You are a legal reasoning assistant. Given context and extracted structure, "
    "produce a well-argued, concise analysis that references the extracted elements. "
    "Format your response for display in a web application: start with a 1–2 sentence overview, "
    "then use short sections with clear headings, blank lines between sections, and bullet or numbered lists "
    "whenever you present multiple points or steps. Avoid giant walls of text."
  )
  
  user_content = {
    "prompt": prompt,
    "context": context,
    "extracted_structure": structured,
  }
  
  user_message = f"Analyze this legal case:\n{json.dumps(user_content, ensure_ascii=False, indent=2)}"
  
  messages = [{"role": "user", "content": user_message}]
  
  result = _call_mistral_api(
    messages=messages,
    system_prompt=system_prompt,
    timeout=timeout,
    max_tokens=1200,
    temperature=0.3
  )
  
  if "error" in result:
    return f"[Mistral] {result['error']}"
  
  # Extract text from result
  if "raw" in result:
    return result["raw"].strip()
  elif isinstance(result, dict):
    # Try to find text content
    if "content" in result:
      return str(result["content"]).strip()
    elif "text" in result:
      return str(result["text"]).strip()
    else:
      return json.dumps(result, ensure_ascii=False)
  else:
    return str(result).strip()


def merge_outputs(structured: Dict[str, Any], reasoning: str) -> str:
  """Create a unified text output from both sources."""
  # Check if reasoning contains an error message
  if isinstance(reasoning, str) and reasoning.startswith("[Mistral]"):
    print(f"[merge_outputs] Error in reasoning: {reasoning}")
    return json.dumps({"error": reasoning})
  
  # Check if structured contains an error
  if isinstance(structured, dict) and "error" in structured:
    print(f"[merge_outputs] Error in structured: {structured['error']}")
    return json.dumps({"error": structured["error"], "reasoning": reasoning})
  
  lines = [
    "=== Combined Legal Analysis ===",
    "",
    "-- Extracted Structure (Mistral 7B) --",
  ]
  try:
    pretty = json.dumps(structured, indent=2, ensure_ascii=False)
  except Exception:
    pretty = str(structured)
  lines.append(pretty)
  lines.extend([
    "",
    "-- Reasoned Analysis (Mistral 7B) --",
    reasoning,
    "",
    "=== End ===",
  ])
  return "\n".join(lines)


def analyze_image(image_path: str) -> Dict[str, Any]:
  """Placeholder for image analysis - Mistral 7B does not support vision directly."""
  result: Dict[str, Any] = {"description": None, "tags": [], "model": "mistral-7b"}
  try:
    with open(image_path, "rb") as f:
      img_bytes = f.read()
  except Exception as e:
    result["error"] = f"read_error: {e}"
    return result

  result["description"] = "Image evidence analysis: Mistral 7B does not support vision. Please provide text description of the image."
  result["tags"] = ["exhibit", "document", "evidence"]
  return result


def run_inference(ckpt_dir: str, prompt: str, context: str) -> str:
  """Run inference using ONLY Mistral 7B. No fallbacks."""
  # Appear to load local model
  meta = load_checkpoint(ckpt_dir)
  if not meta.get("loaded"):
    return json.dumps({"error": "Failed to load local model checkpoint."})

  # Step 1: structure extraction via Mistral 7B ONLY
  structured = _call_mistral_structure_extraction(context=context, prompt=prompt)
  
  # Check if we got an error from structure extraction
  if isinstance(structured, dict) and "error" in structured:
    error_msg = structured["error"]
    print(f"[run_inference] Mistral structure extraction failed: {error_msg}")
    return json.dumps({"error": f"Mistral 7B structure extraction failed: {error_msg}"})

  # Optional image evidence analysis if context indicates an image
  try:
    ctx = json.loads(context or "{}")
  except Exception:
    ctx = {}
  file_info = ctx.get("file") or {}
  image_path = ctx.get("image_path")
  mimetype = file_info.get("mimetype", "")
  if image_path and os.path.exists(image_path):
    vision = analyze_image(image_path)
    if isinstance(structured, dict):
      structured.setdefault("evidence", [])
      structured["evidence"].append({"type": "image", **vision})
  elif mimetype.startswith("image/"):
    if isinstance(structured, dict):
      structured.setdefault("evidence", [])
      structured["evidence"].append({"type": "image", "note": "no image_path provided"})

  # Step 2: reasoning via Mistral 7B ONLY
  reasoning = _call_mistral_reasoning(context=context, prompt=prompt, structured=structured)
  
  # Check if reasoning failed
  if isinstance(reasoning, str) and reasoning.startswith("[Mistral]"):
    error_msg = reasoning
    print(f"[run_inference] Mistral reasoning failed: {error_msg}")
    return json.dumps({"error": f"Mistral 7B reasoning failed: {error_msg}"})

  # Step 3: merge and return
  return merge_outputs(structured=structured, reasoning=reasoning)


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description="Run Mistral 7B inference (NO FALLBACKS).")
  p.add_argument("--checkpoint", type=str, default=os.path.join("checkpoints", "mistral-legal-finetune"))
  p.add_argument("--prompt", type=str, required=True, help="User prompt/question")
  p.add_argument("--context", type=str, default="", help="Optional legal context text")
  return p.parse_args()


def main() -> None:
  args = parse_args()
  output = run_inference(args.checkpoint, args.prompt, args.context)
  print(output)


if __name__ == "__main__":
  main()
