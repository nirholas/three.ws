"""Typed failures of the splat_train stage and their contract exit codes.

Exit codes follow contract C1 of the insta360 campaign: 1 internal error,
2 unsupported input, 3 corrupt or unreadable input, 4 reconstruction quality
failure. Every error carries a snake_case code and a sentence a visitor can read.
"""

EXIT_OK = 0
EXIT_INTERNAL = 1
EXIT_UNSUPPORTED = 2
EXIT_CORRUPT = 3
EXIT_QUALITY = 4


class SplatTrainError(Exception):
    exit_code = EXIT_INTERNAL
    code = 'internal_error'

    def __init__(self, message, code=None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class UnsupportedInput(SplatTrainError):
    exit_code = EXIT_UNSUPPORTED
    code = 'unsupported_input'


class CorruptInput(SplatTrainError):
    exit_code = EXIT_CORRUPT
    code = 'corrupt_input'


class QualityFailure(SplatTrainError):
    exit_code = EXIT_QUALITY
    code = 'quality_too_low'


class GpuUnavailable(SplatTrainError):
    exit_code = EXIT_INTERNAL
    code = 'gpu_unavailable'
