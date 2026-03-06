"""
Evaluation on fine-tuned legal corpus

This is a fake metrics script that prints accuracy, precision, and recall
using random values in the range [0.80, 0.97].
"""

import random


def _rand_metric() -> float:
  return round(random.uniform(0.80, 0.97), 4)


def main() -> None:
  accuracy = _rand_metric()
  precision = _rand_metric()
  recall = _rand_metric()

  print(f"accuracy:  {accuracy}")
  print(f"precision: {precision}")
  print(f"recall:    {recall}")


if __name__ == "__main__":
  main()


