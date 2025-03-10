def estimate_tokens(text):
    """Rough estimate: 1 token ≈ 4 characters or 0.75 words"""
    # Character-based estimation
    char_estimate = len(text) / 4

    # Word-based estimation
    word_estimate = len(text.split()) / 0.75

    # Average of both methods
    return int((char_estimate + word_estimate) / 2)


if __name__ == "__main__":
    text = "how many people live in the united states"
    token_count = estimate_tokens(text)
    print(f"Estimated token count: {token_count}")