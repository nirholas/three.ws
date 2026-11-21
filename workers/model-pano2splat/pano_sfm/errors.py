"""Typed failures that map one to one onto the C1 exit codes."""

EXIT_INTERNAL = 1
EXIT_UNSUPPORTED = 2
EXIT_CORRUPT = 3
EXIT_QUALITY = 4


class PanoSfmError(Exception):
    """A failure with a stable snake_case code, a visitor-readable sentence and an exit code."""

    def __init__(self, code: str, message: str, exit_code: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code


def unsupported(code: str, message: str) -> PanoSfmError:
    return PanoSfmError(code, message, EXIT_UNSUPPORTED)


def corrupt(code: str, message: str) -> PanoSfmError:
    return PanoSfmError(code, message, EXIT_CORRUPT)


def quality(code: str, message: str) -> PanoSfmError:
    return PanoSfmError(code, message, EXIT_QUALITY)
