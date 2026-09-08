"""Read two fixed public health endpoints from the existing gateway runner."""
import datetime
import json
import re
import socket
import ssl
import urllib.error
import urllib.request

ENDPOINTS = (('arthello', 'https://arthello-188-225-38-55.sslip.io/api/health'),
             ('school', 'https://school-188-225-38-55.sslip.io/api/health'))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def observe_health():
    opener = urllib.request.build_opener(NoRedirect())
    records = []
    for name, url in ENDPOINTS:
        record = {'service': name, 'httpStatus': None, 'status': None,
                  'database': None, 'releaseSha': None}
        try:
            request = urllib.request.Request(url, headers={'Accept': 'application/json'}, method='GET')
            with opener.open(request, timeout=15) as response:
                record['httpStatus'] = response.status
                raw = response.read(65_537)
            if len(raw) <= 65_536:
                body = json.loads(raw)
                if isinstance(body, dict):
                    if body.get('status') in ('ok', 'healthy', 'error', 'degraded', 'unavailable'):
                        record['status'] = body['status']
                    if body.get('database') in ('available', 'unavailable', 'ok', 'error'):
                        record['database'] = body['database']
                    sha = body.get('releaseSha')
                    if isinstance(sha, str) and re.fullmatch('[a-f0-9]{40}', sha):
                        record['releaseSha'] = sha
        except urllib.error.HTTPError as error:
            record['httpStatus'] = error.code
            record['error'] = 'http_error_or_redirect'
            error.close()
        except (TimeoutError, socket.timeout):
            record['error'] = 'timeout'
        except (urllib.error.URLError, OSError, ssl.SSLError):
            record['error'] = 'transport_unavailable'
        except (ValueError, TypeError, UnicodeError):
            record['error'] = 'health_body_unrecognized'
        records.append(record)
    return {'observer': 'existing-gateway-runner', 'observedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'requests': records}


if __name__ == '__main__':
    print(json.dumps(observe_health(), sort_keys=True, separators=(',', ':')))
