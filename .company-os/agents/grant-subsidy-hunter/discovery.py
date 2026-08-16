#!/usr/bin/env python3
"""Official-source discovery adapter for Grant & Subsidy Hunter.

The adapter performs a public, read-only scan of official pages, extracts links
that look like support opportunities, maps them to portfolio scopes, compares
them with the previous GitHub issue report, and produces Markdown + JSON.

Discovery is intentionally conservative: every candidate remains
EVIDENCE_PENDING until the primary documents, deadline, eligibility and
economics are reviewed by the evidence/scoring engine.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import ssl
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


USER_AGENT = (
    "CompanyOS-GrantHunter/1.0 "
    "(public official-source monitor; no authentication; contact: repository owner)"
)
TIMEOUT_SECONDS = 25
MAX_RESPONSE_BYTES = 4_000_000
MAX_CANDIDATES_IN_REPORT = 50
MARKER_RE = re.compile(
    r"<!--\s*grant-hunter:fingerprints=(\[[^\n]*\])\s*-->", re.IGNORECASE
)

SUPPORT_TERMS = (
    "грант",
    "субсид",
    "компенсац",
    "мера поддержки",
    "меры поддержки",
    "конкурс",
    "отбор",
    "прием заяв",
    "приём заяв",
    "льготн",
    "финансирован",
    "заем",
    "заём",
    "кредит",
    "гарант",
    "возмещ",
    "акселератор",
    "налогов",
    "инвестиционн",
    "support",
    "grant",
    "subsid",
    "funding",
)

DEADLINE_HINTS = (
    "до ",
    "прием заяв",
    "приём заяв",
    "срок",
    "deadline",
    "2026",
    "2027",
)

TRACKING_QUERY_PREFIXES = ("utm_", "yclid", "gclid", "fbclid", "_openstat")


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    url: str
    priority: int
    default_scopes: tuple[str, ...]
    max_follow_delta: int = 2
    max_follow_full: int = 6


SOURCES: tuple[Source, ...] = (
    Source(
        "fasie",
        "Фонд содействия инновациям",
        "https://fasie.ru/press/fund/",
        100,
        ("AEIC", "Invest Flow", "ArtHello"),
    ),
    Source(
        "frp",
        "Фонд развития промышленности",
        "https://frprf.ru/",
        95,
        ("ИКИОМА", "AgroOS"),
    ),
    Source(
        "gisp",
        "ГИСП — меры поддержки промышленности",
        "https://portfolio.gisp.gov.ru/",
        90,
        ("ИКИОМА", "AgroOS"),
    ),
    Source(
        "government",
        "Правительство России",
        "https://government.ru/docs/",
        80,
        ("ArtHello", "AEIC", "AgroOS", "ИКИОМА", "Invest Flow"),
    ),
    Source(
        "mcx",
        "Минсельхоз России",
        "https://mcx.gov.ru/press-service/news/",
        100,
        ("AgroOS",),
    ),
    Source(
        "minobrnauki",
        "Минобрнауки России",
        "https://minobrnauki.gov.ru/press-center/news/",
        90,
        ("AEIC", "Invest Flow", "ArtHello"),
    ),
    Source(
        "minpros",
        "Минпросвещения России",
        "https://edu.gov.ru/press/",
        90,
        ("ArtHello", "AEIC"),
    ),
    Source(
        "msp",
        "Цифровая платформа МСП.РФ",
        "https://xn--l1agf.xn--p1ai/",
        100,
        ("ArtHello", "AEIC", "AgroOS", "ИКИОМА", "Invest Flow"),
    ),
    Source(
        "spb_science",
        "Санкт-Петербург — наука и высшая школа",
        "https://www.gov.spb.ru/gov/otrasl/c_science/",
        95,
        ("AEIC", "Invest Flow", "ArtHello"),
    ),
    Source(
        "spb_business",
        "Санкт-Петербург — развитие предпринимательства",
        "https://www.gov.spb.ru/gov/otrasl/c_business/",
        95,
        ("ArtHello", "AEIC", "ИКИОМА", "Invest Flow"),
    ),
    Source(
        "lenobl",
        "Правительство Ленинградской области",
        "https://lenobl.ru/",
        95,
        ("ArtHello", "AEIC", "AgroOS", "ИКИОМА", "Invest Flow"),
    ),
    Source(
        "lenobl_applications",
        "Система конкурсных заявок Ленинградской области",
        "https://ssmsp.lenreg.ru/",
        100,
        ("ArtHello", "AEIC", "AgroOS", "ИКИОМА", "Invest Flow"),
    ),
)

PORTFOLIO_KEYWORDS: dict[str, tuple[str, ...]] = {
    "ArtHello": (
        "образован",
        "дет",
        "школ",
        "дошколь",
        "социальн",
        "занятост",
        "дополнительное образование",
        "цифровизац",
        "искусственн",
        "малый бизнес",
        "мсп",
    ),
    "AEIC": (
        "образован",
        "эксперт",
        "молодеж",
        "молодёж",
        "наук",
        "просвет",
        "мероприят",
        "конференц",
        "цифровая платформ",
        "технолог",
    ),
    "AgroOS": (
        "сельск",
        "агро",
        "фермер",
        "апк",
        "растениевод",
        "животновод",
        "сельских территор",
        "оборудован",
        "цифровизац",
        "роботизац",
    ),
    "ИКИОМА": (
        "строитель",
        "жиль",
        "деревообработ",
        "домокомплект",
        "производств",
        "оборудован",
        "энергоэффектив",
        "ипотек",
        "промышлен",
        "лизинг",
    ),
    "Invest Flow": (
        "цифров",
        "искусственн",
        "ии",
        "финтех",
        "проптех",
        "технолог",
        "программ",
        "экспорт",
        "мсп",
        "инновац",
    ),
}


@dataclass
class Link:
    text: str
    url: str


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[Link] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attributes = dict(attrs)
        href = attributes.get("href")
        if href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._href:
            return
        text = normalize_text(" ".join(self._text))
        self.links.append(Link(text=text, url=self._href))
        self._href = None
        self._text = []


@dataclass
class Candidate:
    fingerprint: str
    title: str
    url: str
    source_id: str
    source_name: str
    status: str
    discovery_score: float
    matched_scopes: list[str]
    matched_support_terms: list[str]
    is_new: bool
    evidence_note: str


@dataclass
class SourceHealth:
    source_id: str
    source_name: str
    status: str
    pages_scanned: int
    links_seen: int
    candidates_found: int
    error: str | None


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def clean_url(value: str, base_url: str) -> str | None:
    absolute = urljoin(base_url, value.strip())
    parts = urlsplit(absolute)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return None
    if parts.scheme == "http":
        parts = parts._replace(scheme="https")
    query = [
        (key, val)
        for key, val in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith(TRACKING_QUERY_PREFIXES)
    ]
    return urlunsplit(
        (parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", urlencode(query), "")
    )


def same_official_domain(candidate_url: str, source_url: str) -> bool:
    candidate_host = urlsplit(candidate_url).hostname or ""
    source_host = urlsplit(source_url).hostname or ""
    return candidate_host == source_host or candidate_host.endswith("." + source_host)


def fetch_html(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.4",
            "Accept-Language": "ru,en;q=0.7",
            "Cache-Control": "no-cache",
        },
    )
    context = ssl.create_default_context()
    with urlopen(request, timeout=TIMEOUT_SECONDS, context=context) as response:
        content_type = response.headers.get("Content-Type", "")
        if "html" not in content_type.lower():
            raise ValueError(f"unsupported_content_type:{content_type}")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("response_too_large")
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def parse_links(page_url: str, content: str) -> list[Link]:
    parser = LinkParser()
    parser.feed(content)
    result: list[Link] = []
    seen: set[str] = set()
    for link in parser.links:
        url = clean_url(link.url, page_url)
        if not url or url in seen:
            continue
        seen.add(url)
        title = link.text or Path(urlsplit(url).path).name.replace("-", " ")
        result.append(Link(text=normalize_text(title), url=url))
    return result


def find_terms(text: str, terms: Sequence[str]) -> list[str]:
    lowered = text.casefold()
    return sorted({term for term in terms if term.casefold() in lowered})


def infer_scopes(text: str, source: Source) -> list[str]:
    matched: list[str] = []
    for scope, terms in PORTFOLIO_KEYWORDS.items():
        if find_terms(text, terms):
            matched.append(scope)
    if not matched:
        matched.extend(source.default_scopes)
    return sorted(set(matched))


def make_fingerprint(title: str, url: str) -> str:
    payload = f"{normalize_text(title).casefold()}|{clean_url(url, url) or url}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def discovery_score(
    source: Source,
    support_terms: Sequence[str],
    scopes: Sequence[str],
    text: str,
) -> float:
    source_component = source.priority * 0.25
    support_component = min(len(support_terms), 5) * 5
    scope_component = min(len(scopes), 3) * 10
    deadline_component = 10 if find_terms(text, DEADLINE_HINTS) else 0
    return round(min(100.0, source_component + support_component + scope_component + deadline_component), 1)


def likely_opportunity(text: str, url: str) -> tuple[bool, list[str]]:
    searchable = normalize_text(f"{text} {url}").casefold()
    terms = find_terms(searchable, SUPPORT_TERMS)
    if not terms:
        return False, []
    negative = (
        "итоги" in searchable
        or "победител" in searchable
        or "архив" in searchable
        or "отчет" in searchable
        or "отчёт" in searchable
    )
    if negative and "2026" not in searchable and "2027" not in searchable:
        return False, terms
    return True, terms


def select_follow_links(source: Source, links: Sequence[Link], mode: str) -> list[Link]:
    limit = source.max_follow_full if mode == "full" else source.max_follow_delta
    scored: list[tuple[int, Link]] = []
    for link in links:
        if not same_official_domain(link.url, source.url):
            continue
        relevant, terms = likely_opportunity(link.text, link.url)
        score = len(terms) * 10
        if relevant:
            score += 20
        if any(token in link.url.casefold() for token in ("news", "press", "support", "grant", "subsid")):
            score += 5
        if score:
            scored.append((score, link))
    scored.sort(key=lambda item: (-item[0], item[1].url))
    return [link for _, link in scored[:limit]]


def scan_source(source: Source, mode: str, previous: set[str]) -> tuple[list[Candidate], SourceHealth]:
    pages = [source.url]
    candidates: dict[str, Candidate] = {}
    links_seen = 0
    error: str | None = None
    scanned = 0

    try:
        landing = fetch_html(source.url)
        scanned += 1
        landing_links = parse_links(source.url, landing)
        links_seen += len(landing_links)
        pages.extend(link.url for link in select_follow_links(source, landing_links, mode))

        for index, page_url in enumerate(pages):
            if index == 0:
                links = landing_links
            else:
                try:
                    time.sleep(0.15)
                    page = fetch_html(page_url)
                    scanned += 1
                    links = parse_links(page_url, page)
                    links_seen += len(links)
                except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
                    if error is None:
                        error = f"partial:{type(exc).__name__}:{exc}"
                    continue

            for link in links:
                if not same_official_domain(link.url, source.url):
                    continue
                searchable = normalize_text(f"{link.text} {link.url}")
                relevant, support_terms = likely_opportunity(searchable, link.url)
                if not relevant:
                    continue
                scopes = infer_scopes(searchable, source)
                fingerprint = make_fingerprint(link.text, link.url)
                candidate = Candidate(
                    fingerprint=fingerprint,
                    title=link.text[:300] or "Без названия",
                    url=link.url,
                    source_id=source.id,
                    source_name=source.name,
                    status="EVIDENCE_PENDING",
                    discovery_score=discovery_score(source, support_terms, scopes, searchable),
                    matched_scopes=scopes,
                    matched_support_terms=support_terms,
                    is_new=fingerprint not in previous,
                    evidence_note=(
                        "Найдена ссылка на официальном домене. До APPLY требуется "
                        "проверка первичного положения, дедлайна, eligibility и экономики."
                    ),
                )
                existing = candidates.get(link.url)
                if existing is None or candidate.discovery_score > existing.discovery_score:
                    candidates[link.url] = candidate

    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        error = f"{type(exc).__name__}:{exc}"

    status = "OK"
    if scanned == 0:
        status = "FAILED"
    elif error:
        status = "PARTIAL"

    health = SourceHealth(
        source_id=source.id,
        source_name=source.name,
        status=status,
        pages_scanned=scanned,
        links_seen=links_seen,
        candidates_found=len(candidates),
        error=error,
    )
    return list(candidates.values()), health


def load_previous_fingerprints(path: Path | None) -> set[str]:
    if path is None or not path.exists():
        return set()
    text = path.read_text(encoding="utf-8", errors="replace")
    match = MARKER_RE.search(text)
    if not match:
        return set()
    try:
        values = json.loads(match.group(1))
    except json.JSONDecodeError:
        return set()
    return {str(value) for value in values if value}


def markdown_escape(value: str) -> str:
    return normalize_text(value).replace("|", "\\|")


def render_candidate_table(candidates: Sequence[Candidate]) -> list[str]:
    lines = [
        "| Score | Проекты | Возможность | Источник | Статус |",
        "|---:|---|---|---|---|",
    ]
    for item in candidates:
        title = markdown_escape(item.title)
        scopes = markdown_escape(", ".join(item.matched_scopes))
        source = markdown_escape(item.source_name)
        lines.append(
            f"| {item.discovery_score:.1f} | {scopes} | "
            f"[{title}]({item.url}) | {source} | `{item.status}` |"
        )
    if not candidates:
        lines.append("| — | — | Новых кандидатов не найдено | — | — |")
    return lines


def build_report(
    candidates: Sequence[Candidate],
    health: Sequence[SourceHealth],
    mode: str,
    generated_at: datetime,
) -> str:
    ordered = sorted(
        candidates,
        key=lambda item: (not item.is_new, -item.discovery_score, item.title.casefold()),
    )
    new_items = [item for item in ordered if item.is_new]
    current = ordered[:MAX_CANDIDATES_IN_REPORT]
    fingerprints = sorted({item.fingerprint for item in candidates})

    lines = [
        "# Grant Hunter — портфель возможностей",
        "",
        f"Обновлено: **{generated_at.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}**  ",
        f"Режим: **{mode}**  ",
        f"Официальных источников: **{len(health)}**  ",
        f"Кандидатов: **{len(candidates)}**, новых: **{len(new_items)}**",
        "",
        "> Discovery не является рекомендацией подать заявку. Все новые записи имеют "
        "`EVIDENCE_PENDING` до проверки положения, дедлайна, заявителя, софинансирования "
        "и ожидаемой экономической ценности.",
        "",
        "## Новые находки",
        "",
    ]
    lines.extend(render_candidate_table(new_items[:20]))
    lines.extend(["", "## Текущий портфель", ""])
    lines.extend(render_candidate_table(current))
    lines.extend(
        [
            "",
            "## Здоровье источников",
            "",
            "| Источник | Статус | Страниц | Ссылок | Кандидатов | Ошибка |",
            "|---|---|---:|---:|---:|---|",
        ]
    )
    for item in health:
        error = markdown_escape(item.error or "—")
        lines.append(
            f"| {markdown_escape(item.source_name)} | `{item.status}` | "
            f"{item.pages_scanned} | {item.links_seen} | {item.candidates_found} | {error} |"
        )
    lines.extend(
        [
            "",
            "## Следующий обязательный этап",
            "",
            "Для кандидатов с наибольшим score: открыть официальный документ программы, "
            "подтвердить действующий срок приёма, заполнить eligibility gap list, проверить "
            "допустимые расходы и прогнать карточку через `engine.py`. Только после этого "
            "возможен статус `APPLY`, который всё равно требует человеческого согласования.",
            "",
            f"<!-- grant-hunter:fingerprints={json.dumps(fingerprints, ensure_ascii=False)} -->",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("delta", "full"), default="delta")
    parser.add_argument("--previous-report", type=Path)
    parser.add_argument("--report", type=Path, default=Path("grant-hunter-report.md"))
    parser.add_argument("--json", dest="json_path", type=Path, default=Path("grant-hunter-candidates.json"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    previous = load_previous_fingerprints(args.previous_report)
    all_candidates: list[Candidate] = []
    health: list[SourceHealth] = []

    for source in SOURCES:
        candidates, source_health = scan_source(source, args.mode, previous)
        all_candidates.extend(candidates)
        health.append(source_health)

    deduplicated: dict[str, Candidate] = {}
    for candidate in all_candidates:
        existing = deduplicated.get(candidate.url)
        if existing is None or candidate.discovery_score > existing.discovery_score:
            deduplicated[candidate.url] = candidate

    candidates = list(deduplicated.values())
    generated_at = datetime.now(timezone.utc)
    report = build_report(candidates, health, args.mode, generated_at)
    args.report.write_text(report, encoding="utf-8")

    payload = {
        "generated_at": generated_at.isoformat(),
        "mode": args.mode,
        "summary": {
            "sources": len(health),
            "sources_failed": sum(item.status == "FAILED" for item in health),
            "sources_partial": sum(item.status == "PARTIAL" for item in health),
            "candidates": len(candidates),
            "new_candidates": sum(item.is_new for item in candidates),
        },
        "candidates": [
            asdict(item)
            for item in sorted(candidates, key=lambda item: -item.discovery_score)
        ],
        "source_health": [asdict(item) for item in health],
    }
    args.json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if health and all(item.status == "FAILED" for item in health):
        print("All official sources failed", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
