import asyncio
import websockets
import json

async def test_send_document():
    uri = "ws://localhost:8000/ws/audio"
    async with websockets.connect(uri) as websocket:
        action = {
            "action": "SEND_DOCUMENT",
            "target": {
                "recipient": "john@example.com",
                "document_id": "Medical_Report.pdf"
            }
        }
        await websocket.send(json.dumps(action))
        response = await websocket.recv()
        print("SEND_DOCUMENT Response:", json.loads(response))

async def test_delete_file():
    uri = "ws://localhost:8000/ws/audio"
    async with websockets.connect(uri) as websocket:
        action = {
            "action": "DELETE_FILE",
            "target": {
                "document_id": "temp_file.txt"
            }
        }
        await websocket.send(json.dumps(action))
        response = await websocket.recv()
        print("DELETE_FILE Response:", json.loads(response))

async def test_cancel_appt():
    uri = "ws://localhost:8000/ws/audio"
    async with websockets.connect(uri) as websocket:
        action = {
            "action": "CANCEL_APPT",
            "target": {
                "recipient": "Dr. Smith"
            }
        }
        await websocket.send(json.dumps(action))
        response = await websocket.recv()
        print("CANCEL_APPT Response:", json.loads(response))

async def test_transfer():
    uri = "ws://localhost:8000/ws/audio"
    async with websockets.connect(uri) as websocket:
        action = {
            "action": "TRANSFER",
            "target": {
                "recipient": "Alice",
                "amount": 100
            }
        }
        await websocket.send(json.dumps(action))
        response = await websocket.recv()
        print("TRANSFER Response:", json.loads(response))

if __name__ == "__main__":
    print("Testing WebSocket endpoint...")
    asyncio.run(test_send_document())
    asyncio.run(test_delete_file())
    asyncio.run(test_cancel_appt())
    asyncio.run(test_transfer())
