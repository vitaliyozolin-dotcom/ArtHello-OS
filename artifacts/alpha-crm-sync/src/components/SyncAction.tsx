import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { UseMutationResult } from '@tanstack/react-query';
import { SyncResult } from '@workspace/api-client-react';

interface SyncActionProps<TData = SyncResult> {
  label: string;
  mutation: UseMutationResult<TData, unknown, void, unknown>;
  testId: string;
  onSuccess?: (data: TData) => void;
}

export function SyncAction<TData extends { success: boolean; message: string; recordsCount?: number | null; atlasBranchId?: string | null } = SyncResult>({
  label, mutation, testId, onSuccess,
}: SyncActionProps<TData>) {
  const [result, setResult] = useState<{ success: boolean; message: string; recordsCount?: number | null; atlasBranchId?: string | null } | null>(null);

  const handleClick = () => {
    mutation.mutate(undefined, {
      onSuccess: (res) => {
        setResult(res);
        onSuccess?.(res);
      },
      onError: (err: any) => {
        setResult({ success: false, message: err?.message || 'An error occurred' });
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 p-4 border rounded-md bg-card/50 hover:bg-card/80 transition-colors">
      <Button 
        onClick={handleClick} 
        disabled={mutation.isPending}
        data-testid={testId}
        className="w-full justify-start font-medium"
        variant="outline"
      >
        {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {label}
      </Button>
      
      {result && (
        <div 
          className={`text-sm p-3 rounded border ${
            result.success 
              ? 'bg-green-50/50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-900 dark:text-green-300' 
              : 'bg-red-50/50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300'
          }`}
        >
          <div className="font-mono text-xs mb-1" data-testid={`${testId}-result`}>
            {result.message}
          </div>
          {result.recordsCount !== undefined && result.recordsCount !== null && (
            <div className="font-mono text-xs opacity-80" data-testid={`${testId}-records`}>
              Records processed: {result.recordsCount}
            </div>
          )}
          {result.atlasBranchId && (
            <div className="font-mono text-xs opacity-80" data-testid={`${testId}-atlasId`}>
              Atlas ID: {result.atlasBranchId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
