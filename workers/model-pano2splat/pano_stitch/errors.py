"""Typed failures of the pano_stitch CLI and the exit codes contract C1 fixes for them."""

EXIT_OK = 0
EXIT_INTERNAL = 1
EXIT_UNSUPPORTED = 2
EXIT_CORRUPT = 3


class StitchError(Exception):
    """A failure the CLI reports as one JSON line on stderr and a fixed exit code."""

    exit_code = EXIT_INTERNAL

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class UnsupportedInput(StitchError):
    exit_code = EXIT_UNSUPPORTED


class CorruptInput(StitchError):
    exit_code = EXIT_CORRUPT
