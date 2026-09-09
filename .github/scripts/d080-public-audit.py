"""Persist the current attempt's actual acceptance for the unchanged D063 marker."""
import argparse
import importlib.util
import os
from pathlib import Path
import stat

spec = importlib.util.spec_from_file_location('state', Path(__file__).with_name('d080-candidate-state.py'))
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)


def prepare(path, receipt_path, attempt):
    path = state.absolute(str(path))
    with state.state_lock(path):
        record = state.load_state(path)
        receipt = state.read_private(receipt_path)
        state.validate_receipt(record, receipt, attempt, state.now())
        if record['phase'] != 'candidate-verified' or record['latestAttempt'] != attempt or record.get('acceptanceSha256') != state.digest(receipt):
            raise ValueError('Audit requires the exact verified current-attempt receipt')
        root = state.absolute(str(path.parent / 'public-audit'))
        root.mkdir(mode=0o700, exist_ok=True)
        info = root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('Audit root must be private and owned')
        work = root / ('arthello-deploy-' + record['context']['runId'] + '-' + attempt)
        work.mkdir(mode=0o700)
        state.atomic(work / 'candidate-context.json', record['context'])
        state.atomic(work / 'candidate-acceptance.json', receipt)
        state.atomic(work / 'candidate-state.json', record)
        for directory in (work, root, path.parent):
            descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return work


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--attempt', required=True)
    args = parser.parse_args()
    try:
        print(prepare(args.state, args.receipt, args.attempt))
    except Exception:
        raise SystemExit('ARTHELLO_D080_PUBLIC_AUDIT=BLOCKED')


if __name__ == '__main__':
    main()
