"""Database models. Every row except Firm carries firm_id: one firm must never see another's data."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Firm(Base):
    __tablename__ = "firms"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    settings: Mapped[Optional[dict]] = mapped_column(JSON, default=dict, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=utcnow, nullable=True)


ROLES = ("owner", "admin", "advocate", "clerk")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20), default="advocate")
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)  # E.164 digits, for WhatsApp
    enrolment_no: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)      # Bar Council enrolment
    whatsapp_brief: Mapped[bool] = mapped_column(Boolean, default=False)
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)   # Telegram chat for the brief
    telegram_brief: Mapped[Optional[bool]] = mapped_column(Boolean, default=False, nullable=True)
    last_brief_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)           # one brief per day
    calendar_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)  # .ics feed
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    user_agent: Mapped[str] = mapped_column(String(300), default="")


class Invite(Base):
    __tablename__ = "invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    email: Mapped[str] = mapped_column(String(254))
    role: Mapped[str] = mapped_column(String(20), default="advocate")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(Integer)


class Matter(Base):
    __tablename__ = "matters"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    case_type: Mapped[str] = mapped_column(String(50), default="ni138")
    court: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    case_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cnr: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    client_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    goal: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    current_stage: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    facts: Mapped[dict] = mapped_column(JSON, default=dict)  # name -> ISO date, confirmed by the lawyer
    details: Mapped[Optional[dict]] = mapped_column(JSON, default=dict, nullable=True)  # parties, amounts, etc.
    next_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    sync_status: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[int] = mapped_column(ForeignKey("matters.id"), index=True)
    filename: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    text: Mapped[str] = mapped_column(Text)
    order_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    next_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    directions: Mapped[list] = mapped_column(JSON, default=list)
    detected_stage: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    stage_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    extraction_method: Mapped[str] = mapped_column(String(50), default="rules")
    needs_review: Mapped[list] = mapped_column(JSON, default=list)
    client_message: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[Optional[str]] = mapped_column(String(30), default="upload", nullable=True)  # upload|whatsapp|ecourts
    text_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Task(Base):
    """A proposed or approved action. Nothing changes a matter until a lawyer approves it."""

    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[int] = mapped_column(ForeignKey("matters.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    detail: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(30), default="order")  # order | playbook | lawyer
    status: Mapped[str] = mapped_column(String(20), default="proposed")  # proposed|approved|done|rejected
    action: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # set_next_date | set_stage
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    decided_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Deadline(Base):
    __tablename__ = "deadlines"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[int] = mapped_column(ForeignKey("matters.id"), index=True)
    rule_id: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(300))
    authority: Mapped[str] = mapped_column(String(200), default="")
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="computed")  # computed | missing_input
    needs_confirmation: Mapped[bool] = mapped_column(Boolean, default=True)
    alert_days_before: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    original_due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # before holiday adjustment


class CitationCheck(Base):
    __tablename__ = "citation_checks"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[Optional[int]] = mapped_column(ForeignKey("matters.id"), nullable=True)
    source_text: Mapped[str] = mapped_column(Text)
    items: Mapped[list] = mapped_column(JSON, default=list)
    method: Mapped[str] = mapped_column(String(30), default="rules")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(Integer, index=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100))
    object_type: Mapped[str] = mapped_column(String(50))
    object_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[int] = mapped_column(ForeignKey("matters.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(100), default="advocate")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Bookmark(Base):
    """A judgment (or one paragraph of it) saved by the firm, optionally to a matter."""

    __tablename__ = "bookmarks"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[Optional[int]] = mapped_column(ForeignKey("matters.id"), nullable=True, index=True)
    jid: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(400))
    citation: Mapped[str] = mapped_column(String(200), default="")
    para_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    excerpt: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Draft(Base):
    __tablename__ = "drafts"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    matter_id: Mapped[Optional[int]] = mapped_column(ForeignKey("matters.id"), nullable=True, index=True)
    template: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | final
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SearchHistory(Base):
    __tablename__ = "search_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    query: Mapped[str] = mapped_column(String(500))
    mode: Mapped[str] = mapped_column(String(20), default="search")
    results: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UsageLog(Base):
    """Every AI call: which firm, which feature, which model, how many tokens. Drives budgets and pricing."""

    __tablename__ = "usage_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    feature: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(80), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AnswerCache(Base):
    __tablename__ = "answer_cache"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(Integer, index=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CourtHoliday(Base):
    __tablename__ = "court_holidays"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    name: Mapped[str] = mapped_column(String(200))
    court: Mapped[str] = mapped_column(String(200), default="")  # blank = all courts


class Review(Base):
    """An advocate's sign-off on a playbook rule, stage or draft template, for a specific version."""

    __tablename__ = "reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey("firms.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))   # rule | stage | template
    ref: Mapped[str] = mapped_column(String(100))
    version: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20))  # approved | changes_requested
    comment: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[int] = mapped_column(Integer)
    reviewer_name: Mapped[str] = mapped_column(String(200))
    reviewer_enrolment: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    firm_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30))   # answer | draft | deadline | order | search | general
    ref: Mapped[str] = mapped_column(String(300), default="")
    rating: Mapped[int] = mapped_column(Integer, default=0)  # +1 / -1 / 0
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    wa_id: Mapped[str] = mapped_column(String(120), unique=True)
    firm_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    phone: Mapped[str] = mapped_column(String(20))
    direction: Mapped[str] = mapped_column(String(5))  # in | out
    kind: Mapped[str] = mapped_column(String(20))
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
