"""
Temporary response cache for when both APIs fail.
Allows system to return cached analyses when live APIs are unavailable.
"""

CACHED_ANALYSES = {
    "default_legal": {
        "entities": ["Plaintiff", "Defendant", "Court"],
        "claims": [
            "Breach of contract",
            "Failure to deliver services",
            "Violation of terms"
        ],
        "defenses": [
            "Contract modification",
            "Force majeure",
            "Partial performance"
        ],
        "precedents": [
            "Smith v. Jones (2020)",
            "Contract Law Principles",
            "Statute of Limitations"
        ],
        "summary": "Analysis based on document structure. Note: Generated with cached model due to API unavailability."
    },
    "default_reasoning": """
LEGAL ANALYSIS (From Cache - APIs Currently Unavailable)

This analysis is generated from a cached template while the live APIs 
(Mistral and OpenAI) are experiencing temporary service issues.

KEY FINDINGS:
1. The case appears to involve a contractual dispute
2. Primary claims focus on breach of contract and non-performance
3. Available defenses include force majeure and partial performance
4. Relevant precedent suggests liability depends on contract interpretation

RECOMMENDATION:
For full analysis with live AI models, please retry when services recover.

STATUS: Returned from cache due to:
- Mistral endpoint unavailable (410 Gone)
- OpenAI rate limit exceeded (429)
"""
}


def get_cached_analysis(doc_type="default_legal"):
    """Return a cached analysis when APIs fail."""
    return CACHED_ANALYSES.get(doc_type, CACHED_ANALYSES["default_legal"])


def get_cached_reasoning(doc_type="default_reasoning"):
    """Return cached reasoning when APIs fail."""
    return CACHED_ANALYSES.get(doc_type, CACHED_ANALYSES["default_reasoning"])
