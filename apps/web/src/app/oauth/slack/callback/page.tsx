'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function SlackOAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage(searchParams.get('error_description') || 'Authorization was denied');
      return;
    }

    if (code) {
      // Send the code back to the parent window
      if (window.opener) {
        window.opener.postMessage(
          { type: 'slack-oauth-callback', code },
          window.location.origin
        );
        setStatus('success');
        // Close the popup after a short delay
        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        setStatus('error');
        setErrorMessage('Unable to communicate with the parent window. Please close this window and try again.');
      }
    } else {
      setStatus('error');
      setErrorMessage('No authorization code received from Slack');
    }
  }, [searchParams]);

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4 text-center">
      {status === 'processing' && (
        <>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4A154B] mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connecting to Slack...</h2>
          <p className="text-gray-500">Please wait while we complete the connection.</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connected!</h2>
          <p className="text-gray-500">This window will close automatically.</p>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Failed</h2>
          <p className="text-gray-500 mb-4">{errorMessage}</p>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Close Window
          </button>
        </>
      )}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4A154B] mx-auto mb-4"></div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading...</h2>
    </div>
  );
}

export default function SlackOAuthCallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Suspense fallback={<LoadingFallback />}>
        <SlackOAuthCallbackContent />
      </Suspense>
    </div>
  );
}
