
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/modules/core/ui/primitives/button';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';

const UnauthorizedPage: React.FC = () => {
  const { getLandingPage } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
      <ShieldAlert className="h-16 w-16 text-red-500 mb-6" />
      <h1 className="text-3xl font-bold mb-2">Access Denied</h1>
      <p className="text-white/60 mb-6 max-w-md">
        You don't have permission to access this page. Please contact your administrator if you believe this is an error.
      </p>
      <div className="flex gap-4">
        <Button asChild variant="outline">
          <Link to={getLandingPage()}>Back to Home</Link>
        </Button>
      </div>
    </div>
  );
};

export default UnauthorizedPage;
