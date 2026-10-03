"""
Shared contract types - Python mirror of client/src/types.ts.
Canonical source of truth is the TypeScript file.
Sceneledger release: deployment-instruction comment removed; payload types retained.

All TypedDict keys use camelCase to match the JSON wire format.
DB columns use snake_case; the server maps between them.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

ShapeType = Literal["rectangle", "ellipse", "line", "text"]


class Shape(TypedDict):
    id: str
    type: ShapeType
    x: float
    y: float
    width: float
    height: float
    fill: str
    stroke: str
    strokeWidth: float
    text: NotRequired[str]
    fontSize: NotRequired[float]


class ShapeProps(TypedDict):
    x: float
    y: float
    width: float
    height: float
    fill: str
    stroke: str
    strokeWidth: float
    text: NotRequired[str]
    fontSize: NotRequired[float]


class ShapePatch(TypedDict, total=False):
    x: float
    y: float
    width: float
    height: float
    fill: str
    stroke: str
    strokeWidth: float
    text: str
    fontSize: float


class AddOp(TypedDict):
    kind: Literal["add"]
    shape: Shape


class UpdateOp(TypedDict):
    kind: Literal["update"]
    shapeId: str
    props: ShapePatch


class DeleteOp(TypedDict):
    kind: Literal["delete"]
    shapeId: str


Operation = AddOp | UpdateOp | DeleteOp


class UndoEntry(TypedDict):
    forward: Operation
    reverse: Operation


class PresenceUser(TypedDict):
    userId: str
    username: str
    color: str


class OpClientMessage(TypedDict):
    type: Literal["op"]
    op: Operation
    opId: str


class CursorClientMessage(TypedDict):
    type: Literal["cursor"]
    x: float
    y: float


ClientMessage = OpClientMessage | CursorClientMessage


class InitServerMessage(TypedDict):
    type: Literal["init"]
    shapes: list[Shape]
    users: list[PresenceUser]
    seq: int


class OpServerMessage(TypedDict):
    type: Literal["op"]
    op: Operation
    userId: str
    seq: int
    opId: str


class CursorServerMessage(TypedDict):
    type: Literal["cursor"]
    userId: str
    username: str
    x: float
    y: float


class JoinServerMessage(TypedDict):
    type: Literal["join"]
    user: PresenceUser


class LeaveServerMessage(TypedDict):
    type: Literal["leave"]
    userId: str


class ErrorServerMessage(TypedDict):
    type: Literal["error"]
    message: str


ServerMessage = (
    InitServerMessage
    | OpServerMessage
    | CursorServerMessage
    | JoinServerMessage
    | LeaveServerMessage
    | ErrorServerMessage
)


class AuthUser(TypedDict):
    id: str
    username: str
    email: str


class SignupRequest(TypedDict):
    username: str
    email: str
    password: str


class LoginRequest(TypedDict):
    username: str
    password: str


class AuthResponse(TypedDict):
    token: str
    user: AuthUser


class CanvasSummary(TypedDict):
    id: str
    name: str
    ownerId: str
    createdAt: str


class CanvasMember(TypedDict):
    userId: str
    username: str


class CanvasDetail(CanvasSummary):
    shapes: list[Shape]
    members: list[CanvasMember]


class CreateCanvasRequest(TypedDict):
    name: str


class InviteRequest(TypedDict):
    identifier: str


class ErrorResponse(TypedDict):
    error: str


CURSOR_PALETTE = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6"]

SHAPE_DB_TO_WIRE = {
    "stroke_width": "strokeWidth",
    "font_size": "fontSize",
}
SHAPE_WIRE_TO_DB = {value: key for key, value in SHAPE_DB_TO_WIRE.items()}
