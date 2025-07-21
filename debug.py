from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/calendar']

flow = InstalledAppFlow.from_client_secrets_file(
    'credentials.json', SCOPES
)
creds = flow.run_local_server(port=0)
print('Refresh Token:', creds.refresh_token)
# Save creds to token.json if needed
with open('token.json', 'w') as token:
    token.write(creds.to_json())