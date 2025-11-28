'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      setStatus('error');
      setMessage(errorDescription || error);
      return;
    }

    if (code) {
      // Send the code back to the VSCode extension
      if (window.opener) {
        window.opener.postMessage(
          {
            type: 'github-oauth-callback',
            code,
          },
          '*'
        );
        setStatus('success');
        setMessage('Authentication successful! You can close this window.');

        // Auto-close after 2 seconds
        setTimeout(() => {
          window.close();
        }, 2000);
      } else {
        setStatus('success');
        setMessage(`Authentication code received. Please copy this code: ${code}`);
      }
    } else {
      setStatus('error');
      setMessage('No authorization code received');
    }
  }, [searchParams]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          {status === 'processing' && <Loader2 className="w-6 h-6 animate-spin" />}
          {status === 'success' && <CheckCircle className="w-6 h-6 text-green-600" />}
          {status === 'error' && <XCircle className="w-6 h-6 text-red-600" />}
          <CardTitle>
            {status === 'processing' && 'Processing...'}
            {status === 'success' && 'Success!'}
            {status === 'error' && 'Error'}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-base">
          {message}
        </CardDescription>
      </CardContent>
    </Card>
  );
}

export default function OAuthCallback() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Suspense fallback={
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <CardTitle>Loading...</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription className="text-base">
              Initializing authentication...
            </CardDescription>
          </CardContent>
        </Card>
      }>
        <OAuthCallbackContent />
      </Suspense>
    </main>
  );
}
