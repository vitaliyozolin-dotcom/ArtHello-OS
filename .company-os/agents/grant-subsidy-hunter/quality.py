#!/usr/bin/env python3
"""Precision filter for Grant Hunter discovery candidates.

The discovery adapter intentionally casts a wider net. This module rejects
non-financial contests, personal benefits, result pages, login/accreditation
links, stale regulations and duplicate document variants before publication.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable


def _compiled(patterns: Iterable[str]) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)


FINANCIAL_SUPPORT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("грант", re.compile(r"\bгрант\w*", re.IGNORECASE)),
    ("субсидия", re.compile(r"\bсубсид\w*", re.IGNORECASE)),
    ("компенсация", re.compile(r"\bкомпенсац\w*", re.IGNORECASE)),
    ("возмещение", re.compile(r"\bвозмещ\w*", re.IGNORECASE)),
    ("льготное финансирование", re.compile(r"\bльготн\w*\s+(?:финансирован\w*|кредит\w*|за[её]м\w*|лизинг\w*)", re.IGNORECASE)),
    ("заем", re.compile(r"\b(?:микро)?(?:за[её]м|займ)\w*", re.IGNORECASE)),
    ("кредит", re.compile(r"\bкредит\w*", re.IGNORECASE)),
    ("гарантия", re.compile(r"\bгарант(?:ия|ии|ию|ией|ий)\b", re.IGNORECASE)),
    ("налоговая льгота", re.compile(r"\bналогов\w*\s+(?:льгот\w*|вычет\w*)", re.IGNORECASE)),
    ("акселератор", re.compile(r"\bакселератор\w*", re.IGNORECASE)),
    ("grant", re.compile(r"\bgrant\w*", re.IGNORECASE)),
    ("subsidy", re.compile(r"\bsubsid\w*", re.IGNORECASE)),
    ("funding", re.compile(r"\bfunding\b", re.IGNORECASE)),
)

ACTION_PATTERNS = _compiled(
    (
        r"\bобъяв\w*",
        r"\bоткрыт\w*",
        r"\bпри[её]м\w*\s+заяв\w*",
        r"\bконкурс\w*",
        r"\bотбор\w*",
        r"\bпорядок\w*\s+предоставлен\w*",
        r"\bправил\w*\s+предоставлен\w*",
        r"\bпрограмм\w*",
        r"\bсрок\w*\s+(?:подач\w*|при[её]м\w*)",
    )
)

EXCLUSION_PATTERNS = _compiled(
    (
        r"\bаккредитац\w*",
        r"\bжурналист\w*",
        r"\bсми\b",
        r"^\s*войти\s*$",
        r"\bучастник\w*\s+сво\b",
        r"\bсем\w*\s+участник\w*\s+сво\b",
        r"\bподдержк\w*\s+участник\w*\s+сво\b",
        r"\bльготн\w*\s+проезд\w*",
        r"\bсоциальн\w*\s+проезд\w*",
        r"\bпут[её]в\w*",
        r"\bпамятник\w*",
        r"\bслухов\w*\s+аппарат\w*",
        r"\bкоммунальн\w*\s+услуг\w*",
        r"\bбесплатн\w*\s+юридическ\w*",
        r"\bрезультат\w*\s+(?:рассмотрен\w*|отбор\w*|конкурс\w*)",
        r"\bподведен\w*\s+итог\w*",
        r"\bитог\w*\s+(?:отбор\w*|конкурс\w*)",
        r"\bпобедител\w*",
        r"\bпротокол\w*",
        r"\bплощадк\w*\s+отбор\w*",
        r"^\s*субсидии\s*$",
        r"^\s*конкурсн\w*\s+отбор\s*\(",
        r"\bантикоррупцион\w*\s+реклам\w*",
    )
)

PROJECT_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "ArtHello": _compiled(
        (
            r"\bобразован\w*",
            r"\bдетск\w*",
            r"\bшкол\w*",
            r"\bдошколь\w*",
            r"\bсоциальн\w*\s+предприним\w*",
            r"\bзанятост\w*",
            r"\bкреативн\w*\s+индустр\w*",
        )
    ),
    "AEIC": _compiled(
        (
            r"\bнауч\w*",
            r"\bобразован\w*",
            r"\bмолод[её]ж\w*",
            r"\bпросвет\w*",
            r"\bконференц\w*",
            r"\bконгресс\w*",
            r"\bфорум\w*",
            r"\bэксперт\w*",
        )
    ),
    "AgroOS": _compiled(
        (
            r"\bагро\w*",
            r"\bсельск\w*",
            r"\bфермер\w*",
            r"\bапк\b",
            r"\bрастениевод\w*",
            r"\bживотновод\w*",
            r"\bрыбохозяй\w*",
            r"\bагромотиватор\w*",
        )
    ),
    "ИКИОМА": _compiled(
        (
            r"\bстроител\w*",
            r"\bжилищ\w*",
            r"\bдомокомплект\w*",
            r"\bдеревообработ\w*",
            r"\bгазификац\w*",
            r"\bэнергоэффектив\w*",
            r"\bпромышлен\w*",
            r"\bлизинг\w*",
            r"\bоборудован\w*",
        )
    ),
    "Invest Flow": _compiled(
        (
            r"\bцифров\w*",
            r"\bискусственн\w*\s+интеллект\w*",
            r"\bфинтех\w*",
            r"\bпроптех\w*",
            r"\bтехнолог\w*",
            r"\bинновац\w*",
            r"\bпрограмм\w*\s+обеспечен\w*",
            r"\bэкспорт\w*\s+технолог\w*",
        )
    ),
    "Portfolio": _compiled(
        (
            r"\bмсп\b",
            r"\bмал\w*\s+(?:и\s+средн\w*\s+)?предприним\w*",
            r"\bсубъект\w*\s+мал\w*\s+предприним\w*",
            r"\bсамозанят\w*",
            r"\bпредпринимател\w*",
            r"\bэкспорт[её]р\w*",
            r"\bмикрозайм\w*",
        )
    ),
}

SOURCE_FALLBACK_SCOPES: dict[str, tuple[str, ...]] = {
    "fasie": ("Invest Flow", "AEIC"),
    "frp": ("ИКИОМА", "AgroOS"),
    "gisp": ("ИКИОМА", "AgroOS"),
    "mcx": ("AgroOS",),
    "minobrnauki": ("AEIC", "Invest Flow"),
    "minpros": ("ArtHello", "AEIC"),
    "msp": ("Portfolio",),
    "spb_science": ("AEIC", "Invest Flow"),
    "spb_business": ("Portfolio",),
    "lenobl_applications": ("Portfolio",),
}


def normalize_title(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip().casefold()
    value = re.sub(r"[«»\"'“”]", "", value)
    return value


def _matches_any(text: str, patterns: Iterable[re.Pattern[str]]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def _support_labels(text: str) -> list[str]:
    return sorted(
        {
            label
            for label, pattern in FINANCIAL_SUPPORT_PATTERNS
            if pattern.search(text)
        }
    )


def _project_scopes(text: str, source_id: str) -> list[str]:
    scopes = [
        scope
        for scope, patterns in PROJECT_PATTERNS.items()
        if _matches_any(text, patterns)
    ]
    if not scopes:
        scopes.extend(SOURCE_FALLBACK_SCOPES.get(source_id, ()))
    return sorted(set(scopes))


def _is_stale_title(text: str) -> bool:
    years = {int(value) for value in re.findall(r"\b20\d{2}\b", text)}
    current_year = datetime.now(timezone.utc).year
    return bool(years) and max(years) < current_year


def qualify(candidate: Any) -> Any | None:
    title = normalize_title(candidate.title)
    if not title or _is_stale_title(title):
        return None
    if _matches_any(title, EXCLUSION_PATTERNS):
        return None

    support_labels = _support_labels(title)
    if not support_labels:
        return None
    if not _matches_any(title, ACTION_PATTERNS):
        return None

    scopes = _project_scopes(title, candidate.source_id)
    if not scopes:
        return None

    current_year = datetime.now(timezone.utc).year
    current_year_bonus = 10 if str(current_year) in title else 0
    source_specificity_bonus = 5 if candidate.source_id not in {"government", "lenobl"} else 0
    score = min(
        100.0,
        45
        + min(len(support_labels), 3) * 8
        + min(sum(bool(pattern.search(title)) for pattern in ACTION_PATTERNS), 2) * 8
        + min(len(scopes), 2) * 5
        + current_year_bonus
        + source_specificity_bonus,
    )

    candidate.matched_scopes = scopes
    candidate.matched_support_terms = support_labels
    candidate.discovery_score = round(score, 1)
    candidate.evidence_note = (
        "Quality gate passed. До APPLY всё равно обязательны первичное положение, "
        "действующий дедлайн, eligibility, допустимые расходы и экономика."
    )
    return candidate


def canonical_key(candidate: Any) -> str:
    title = normalize_title(candidate.title)
    title = re.sub(r"\s*\((?:pdf|docx?|xlsx?)\)\s*$", "", title)
    title = re.sub(r"\s+", " ", title)
    return f"{candidate.source_id}|{title}"


def filter_candidates(candidates: Iterable[Any]) -> list[Any]:
    selected: dict[str, Any] = {}
    for candidate in candidates:
        qualified = qualify(candidate)
        if qualified is None:
            continue
        key = canonical_key(qualified)
        existing = selected.get(key)
        if existing is None or qualified.discovery_score > existing.discovery_score:
            selected[key] = qualified
    return sorted(
        selected.values(),
        key=lambda item: (-item.discovery_score, item.title.casefold()),
    )
