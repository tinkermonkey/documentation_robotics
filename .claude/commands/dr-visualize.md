# DR Visualization Server

Launch the Documentation Robotics visualization server with embedded authentication.

## Steps to Execute

1. **Check if server is already running**
   - Run: `ps aux | grep "dr visualize" | grep -v grep`
   - If running, inform user and ask if they want to restart

2. **Start the visualization server**
   - Run: `dr visualize --no-browser` to prevent auto-opening browser
   - The command will output the server URL with an embedded auth token in a panel
   - **IMPORTANT**: The server runs in the foreground and will block until stopped
   - Capture the magic link from the output panel

3. **Present the URL to the user**
   - Format it clearly and make it clickable
   - Explain that the URL contains an embedded authentication token
   - Warn that they should keep it secure and not share it

4. **Explain how to stop the server**
   - The server runs in the foreground
   - To stop: Press Ctrl+C in the terminal where it's running
   - Or if running in background: `pkill -f "dr visualize"`

## Expected Output Format

The server will output:
1. Model loading status: "✓ Model loaded successfully (N layers)"
2. A panel with the magic link containing the auth token
3. Server details: host, port, model path
4. Instructions: "Press Ctrl+C to stop the server"

The magic link format: `http://localhost:8080?token=<auth-token>`

Extract the magic link from the panel and present it prominently to the user.

## Security Note

The URL contains an authentication token. Remind the user:
- This token grants access to their DR model
- Don't share the URL publicly
- The token is valid while the server is running
- Stopping the server invalidates the token

---

**Execute the steps above and help the user access their DR visualization.**
