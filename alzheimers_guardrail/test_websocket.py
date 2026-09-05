import asyncio
import websockets
import json

async def test_action(action_type, target):
    try:
        async with websockets.connect('ws://localhost:8000/ws/audio') as websocket:
            action = {
                "action": action_type,
                "target": target
            }
            await websocket.send(json.dumps(action))
            response = await websocket.recv()
            print(f"[{action_type}] Response:", json.loads(response))
    except Exception as e:
        print(f"[{action_type}] Error:", e)

async def main():
    # Test SEND_DOCUMENT
    await test_action("SEND_DOCUMENT", {
        "recipient": "john@example.com",
        "document_id": "Medical_Report.pdf"
    })
    
    # Test DELETE_FILE
    await test_action("DELETE_FILE", {
        "document_id": "temp_file.txt"
    })
    
    # Test CANCEL_APPT
    await test_action("CANCEL_APPT", {
        "recipient": "Dr. Smith"
    })
    
    # Test TRANSFER
    await test_action("TRANSFER", {
        "recipient": "Alice",
        "amount": 100
    })

if __name__ == "__main__":
    asyncio.run(main())
