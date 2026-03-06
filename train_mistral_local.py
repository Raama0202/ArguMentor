


"""

import os
import json
import time
import random
import argparse
import warnings
from dataclasses import dataclass
from typing import List, Dict, Any, Iterable

# Required imports per spec (even though we won't actually train)
import torch  # noqa: F401
from datasets import Dataset  # noqa: F401
from transformers import AutoTokenizer  # noqa: F401

try:
  from tqdm import tqdm
except Exception:  # Fallback minimal progress bar if tqdm is unavailable
  def tqdm(iterable, total=None, desc=None):
    for i, item in enumerate(iterable, 1):
      if total:
        print(f"{desc or 'progress'}: {i}/{total}")
      yield item


warnings.filterwarnings("ignore")
random.seed(42)


@dataclass
class TrainConfig:
  model_name: str = "mistralai/Mistral-7B-Instruct-v0.2"
  max_length: int = 512
  batch_size: int = 2
  epochs: int = 2
  lr: float = 1e-5
  output_dir: str = os.path.join("checkpoints", "mistral-legal-finetune")


def load_legal_dataset() -> Dataset:
  """Return a tiny mocked legal dataset that 'looks' real enough."""
  legal_snippets: List[str] = [
    (
      "In Smith v. Jones (2024), the court evaluated the enforceability of a non-"
      "compete clause and held that reasonable temporal and geographic limitations"
      " are essential under state law."
    ),
    (
      "The petitioner contends that the respondent's disclosure constituted a breach"
      " of fiduciary duty and violated the confidentiality agreement executed on"
      " March 12, 2022."
    ),
    (
      "Defendant argues the contract is void for lack of consideration, citing the"
      " absence of mutual obligation and failure to provide any new benefit."
    ),
    (
      "Precedent in Martinez v. TechCo (2018) supports limiting injunctive relief to"
      " prevent undue hardship on the employee when restrictions are overly broad."
    ),
    (
      "The court applied the reasonableness test, balancing legitimate business"
      " interests against the restraint on trade and professional mobility."
    ),
  ]

  return Dataset.from_dict({"text": legal_snippets})


def preprocess_text(example: Dict[str, Any]) -> Dict[str, Any]:
  """Perform simple, realistic-looking text cleaning."""
  text = example.get("text", "")
  text = text.replace("\n", " ").strip()
  # Normalize whitespace
  text = " ".join(text.split())
  return {"text": text}


class _FallbackTokenizer:
  """
  Minimal fallback tokenizer to avoid network/model downloads.
  Mimics a tiny subset of the HF tokenizer API used here.
  """

  def __init__(self, model_name: str, max_length: int = 512):
    self.model_name = model_name
    self.max_length = max_length
    self.pad_token_id = 0

  @classmethod
  def from_pretrained(cls, model_name: str, use_fast: bool = True, local_files_only: bool = True):  # noqa: D401
    return cls(model_name)

  def __call__(self, texts: List[str], truncation: bool = True, max_length: int = 512, padding: str = "max_length") -> Dict[str, Any]:
    input_ids = []
    attention_mask = []
    for txt in texts:
      # Naive wordpiece: map words to pseudo-ids via hash
      tokens = [abs(hash(w)) % 32000 for w in txt.split()]
      if truncation:
        tokens = tokens[:max_length]
      # Pad
      if padding == "max_length" and len(tokens) < max_length:
        pad_len = max_length - len(tokens)
        tokens = tokens + [self.pad_token_id] * pad_len
      mask = [1 if t != self.pad_token_id else 0 for t in tokens]
      input_ids.append(tokens)
      attention_mask.append(mask)
    return {"input_ids": input_ids, "attention_mask": attention_mask}

  def save_pretrained(self, out_dir: str) -> None:  # For realism
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "tokenizer_config.json"), "w", encoding="utf-8") as f:
      json.dump({"model_name": self.model_name, "max_length": self.max_length}, f, indent=2)


def get_tokenizer(model_name: str, max_length: int) -> Any:
  """Try to load a real tokenizer locally; otherwise, use fallback."""
  try:
    # Attempt local-only load so we don't trigger downloads.
    tok = AutoTokenizer.from_pretrained(model_name, use_fast=True, local_files_only=True)
    # Add pad token if missing to make batching logic look realistic
    if tok.pad_token is None:
      tok.pad_token = tok.eos_token if getattr(tok, "eos_token", None) else "<pad>"
    return tok
  except Exception:
    return _FallbackTokenizer.from_pretrained(model_name, use_fast=True, local_files_only=True)


def tokenize_function(batch: Dict[str, List[str]], tokenizer: Any, max_length: int) -> Dict[str, Any]:
  """Vectorize a batch of texts using the tokenizer interface."""
  return tokenizer(batch["text"], truncation=True, max_length=max_length, padding="max_length")


def chunk_iterable(items: List[Any], batch_size: int) -> Iterable[List[Any]]:
  for i in range(0, len(items), batch_size):
    yield items[i : i + batch_size]


def create_dataloader(tokenized: Dict[str, Any], batch_size: int) -> List[Dict[str, Any]]:
  """Return a list of mini-batches to simulate a DataLoader."""
  examples = [
    {"input_ids": ids, "attention_mask": msk}
    for ids, msk in zip(tokenized["input_ids"], tokenized["attention_mask"])
  ]
  batches = [{
    "input_ids": [ex["input_ids"] for ex in chunk],
    "attention_mask": [ex["attention_mask"] for ex in chunk],
  } for chunk in chunk_iterable(examples, batch_size)]
  return batches


def pseudo_train(dataloader: List[Dict[str, Any]], epochs: int, lr: float) -> None:
  """Simulate a training loop with tqdm bars and fake loss values."""
  print(f"Starting pseudo training for {epochs} epoch(s) — lr={lr}")
  global_step = 0
  for epoch in range(1, epochs + 1):
    epoch_bar = tqdm(dataloader, total=len(dataloader), desc=f"Epoch {epoch}")
    for step, batch in enumerate(epoch_bar, 1):
      # Fake compute time
      time.sleep(0.05)
      # Generate a plausible decaying loss curve
      base = max(0.1, 5.0 / (epoch * step + 5))
      jitter = random.uniform(-0.03, 0.03)
      loss = round(base + jitter, 4)
      epoch_bar.set_postfix({"loss": loss})
      global_step += 1
    print(f"Completed epoch {epoch} — steps: {len(dataloader)}, last_loss: {loss}")


def save_model(output_dir: str, tokenizer: Any) -> None:
  """Create a fake checkpoint directory with lightweight metadata files."""
  os.makedirs(output_dir, exist_ok=True)

  # Minimal training args/config to look real
  train_state = {
    "model_name": "mistralai/Mistral-7B-Instruct-v0.2",
    "global_step": 123,
    "epoch": 2,
    "best_eval_loss": 1.2345,
    "date": time.strftime("%Y-%m-%d %H:%M:%S"),
  }
  with open(os.path.join(output_dir, "trainer_state.json"), "w", encoding="utf-8") as f:
    json.dump(train_state, f, indent=2)

  # Tiny config to mimic model card
  config = {
    "architectures": ["MistralForCausalLM"],
    "vocab_size": 32000,
    "hidden_size": 4096,
    "num_attention_heads": 32,
    "num_hidden_layers": 32,
  }
  with open(os.path.join(output_dir, "config.json"), "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)

  # Save a tiny placeholder instead of a large model binary
  with open(os.path.join(output_dir, "pytorch_model.bin"), "wb") as f:
    f.write(b"FAKE_MODEL_WEIGHTS_PLACEHOLDER\n")

  # Save tokenizer in a nested folder as HF would
  tok_dir = os.path.join(output_dir, "tokenizer")
  if hasattr(tokenizer, "save_pretrained"):
    tokenizer.save_pretrained(tok_dir)
  else:
    os.makedirs(tok_dir, exist_ok=True)
    with open(os.path.join(tok_dir, "tokenizer_config.json"), "w", encoding="utf-8") as f:
      json.dump({"note": "fallback tokenizer"}, f, indent=2)

  print(f"Saved fake checkpoint to: {output_dir}")


def parse_args() -> TrainConfig:
  parser = argparse.ArgumentParser(description="Pseudo fine-tune Mistral 7B on legal datasets (no real training)")
  parser.add_argument("--model_name", type=str, default=TrainConfig.model_name)
  parser.add_argument("--max_length", type=int, default=TrainConfig.max_length)
  parser.add_argument("--batch_size", type=int, default=TrainConfig.batch_size)
  parser.add_argument("--epochs", type=int, default=TrainConfig.epochs)
  parser.add_argument("--lr", type=float, default=TrainConfig.lr)
  parser.add_argument("--output_dir", type=str, default=TrainConfig.output_dir)
  args = parser.parse_args()
  return TrainConfig(
    model_name=args.model_name,
    max_length=args.max_length,
    batch_size=args.batch_size,
    epochs=args.epochs,
    lr=args.lr,
    output_dir=args.output_dir,
  )


def main() -> None:
  cfg = parse_args()

  print("Loading mocked legal dataset…")
  ds = load_legal_dataset()

  print("Preprocessing…")
  ds = ds.map(preprocess_text)

  print(f"Preparing tokenizer: {cfg.model_name}")
  tokenizer = get_tokenizer(cfg.model_name, cfg.max_length)

  print("Tokenizing (batched)…")
  tokenized = Dataset.from_dict({"text": ds["text"]}).map(
    lambda batch: tokenize_function(batch, tokenizer, cfg.max_length),
    batched=True,
  )

  print("Creating pseudo dataloader…")
  dataloader = create_dataloader({
    "input_ids": tokenized["input_ids"],
    "attention_mask": tokenized["attention_mask"],
  }, cfg.batch_size)

  pseudo_train(dataloader, cfg.epochs, cfg.lr)

  print("Saving fake checkpoint…")
  save_model(cfg.output_dir, tokenizer)

  print("Done. (No actual training was performed.)")


if __name__ == "__main__":
  main()


