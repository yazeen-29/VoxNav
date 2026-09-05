from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import logging
import time
import math
from risk_engine.scorer import calculate_risk, get_policy
from context_engine.processor import get_context_and_explanation

app = FastAPI()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def validate_and_sanitize(action_data: dict) -> tuple[str, dict, list]:
    """
    Validate action structure and sanitize inputs.
    Returns (action_type, target, validation_errors)
    """
    if not isinstance(action_data, dict):
        return "", {}, ["Request must be a JSON object"]

    errors = []

    # Check action field
    action_type = action_data.get("action")
    if not action_type:
        errors.append("Missing 'action' field")
    elif action_type not in ["SEND_DOCUMENT", "DELETE_FILE", "CANCEL_APPT", "TRANSFER"]:
        errors.append(f"Invalid action type: {action_type}")

    # Check target field
    target = action_data.get("target")
    if not isinstance(target, dict):
        errors.append("'target' must be a dictionary")
        target = {}

    # Sanitize and validate target based on action type
    if action_type == "SEND_DOCUMENT":
        # recipient: string, required
        recipient = target.get("recipient", "")
        if not isinstance(recipient, str):
            errors.append("'recipient' must be a string")
            recipient = ""
        recipient = recipient.strip()
        if not recipient:
            errors.append("'recipient' required for SEND_DOCUMENT")
        target["recipient"] = recipient

        # document_id: optional string
        document_id = target.get("document_id", "")
        if document_id is not None:
            if not isinstance(document_id, str):
                errors.append("'document_id' must be a string if provided")
                document_id = ""
            document_id = document_id.strip()
        target["document_id"] = document_id

    elif action_type == "DELETE_FILE":
        # file_id: string, required (using document_id field per interface)
        file_id = target.get("document_id", "")
        if not isinstance(file_id, str):
            errors.append("'document_id' (file_id) must be a string")
            file_id = ""
        file_id = file_id.strip()
        if not file_id:
            errors.append("'document_id' required for DELETE_FILE")
        target["document_id"] = file_id
        # recipient not used for DELETE_FILE; ignore if present

    elif action_type == "CANCEL_APPT":
        # recipient: string, required (the participant/clinic)
        recipient = target.get("recipient", "")
        if not isinstance(recipient, str):
            errors.append("'recipient' must be a string")
            recipient = ""
        recipient = recipient.strip()
        if not recipient:
            errors.append("'recipient' required for CANCEL_APPT")
        target["recipient"] = recipient
        # document_id not used; ignore if present

    elif action_type == "TRANSFER":
        # recipient: string, required
        recipient = target.get("recipient", "")
        if not isinstance(recipient, str):
            errors.append("'recipient' must be a string")
            recipient = ""
        recipient = recipient.strip()
        if not recipient:
            errors.append("'recipient' required for TRANSFER")
        target["recipient"] = recipient

        # document_id not used; ignore if present

        # amount: required number
        amount = target.get("amount")
        if amount is None:
            errors.append("'amount' required for TRANSFER")
            amount = 0
        # bool is a subclass of int in Python, but it is not a valid amount.
        if isinstance(amount, bool) or not isinstance(amount, (int, float)):
            errors.append("'amount' must be a number")
            amount = 0
        elif not math.isfinite(amount):
            errors.append("'amount' must be finite")
            amount = 0
        # Ensure non-negative
        if amount < 0:
            errors.append("'amount' must be non-negative")
            amount = 0
        target["amount"] = amount

    return action_type, target, errors


def build_action_response(data: str) -> dict:
    """Parse, validate, and process one WebSocket payload.

    Keeping this side-effect-free makes the wire protocol testable without a
    running server and ensures malformed JSON receives a user-safe error.
    """
    try:
        action_data = json.loads(data)
    except (TypeError, json.JSONDecodeError):
        return {"error": "Invalid JSON"}

    action_type, target, validation_errors = validate_and_sanitize(action_data)
    if validation_errors:
        logger.warning("Validation errors: %s", validation_errors)
        return {"error": "Validation failed", "details": validation_errors}

    logger.info("Valid action: %s with target %s", action_type, target)
    risk_result = calculate_risk(action_type, target)
    policy_result = get_policy(action_type)
    context_result = get_context_and_explanation(action_type, target, policy_result)
    return {
        **risk_result,
        "explanation": context_result["explanation"],
        "privacy_log": context_result["privacy_log"],
    }

@app.websocket("/ws/audio")
async def websocket_endpoint(websocket: WebSocket):
    try:
        await websocket.accept()
    except Exception as e:
        logger.error(f"Failed to accept WebSocket connection: {e}", exc_info=True)
        return
    logger.info("WebSocket connection accepted")
    print("WebSocket connection accepted (print)")
    while True:
        print("=== ENTERING WHILE LOOP ITERATION ===")
        logger.info("Entering while loop iteration")
        start_time = time.perf_counter()
        logger.info("Waiting for message from client...")
        try:
            # Receive structured action from client
            logger.info("About to call receive_text()")
            data = await websocket.receive_text()
            logger.info("receive_text() returned successfully")
            response = build_action_response(data)
            # This is backend processing time; the extension separately records
            # full client-to-server round-trip time.
            response["processing_ms"] = round((time.perf_counter() - start_time) * 1000, 1)
            await websocket.send_json(response)
        except WebSocketDisconnect:
            logger.info("Client disconnected")
            break
        except Exception as e:
            logger.error(f"Unexpected error in websocket endpoint: {e}", exc_info=True)
            try:
                await websocket.send_json({"error": "Internal server error"})
            except Exception:
                # If we can't send, break because the connection is likely broken.
                break
        finally:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"Request processed in {duration_ms:.2f} ms")
            if duration_ms > 500:
                logger.warning(f"Request exceeded 500ms threshold: {duration_ms:.2f} ms")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
