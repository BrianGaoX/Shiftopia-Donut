/**
 * usePlanningRequest
 *
 * Fetches a single planning request and all of its offers from the
 * planning_requests / planning_offers tables. Stays fresh via a
 * Supabase Realtime channel — any INSERT / UPDATE on either table
 * that affects the watched request_id triggers an immediate refetch.
 *
 * Falls back to 10-second polling when the realtime subscription fails
 * (e.g. network flap or channel error), then reconnects automatically.
 *
 * Returns:
 *   request   — the PlanningRequest row, or null when not yet loaded / not found
 *   offers    — ordered list of PlanningOffer rows (ascending created_at)
 *   isLoading — true on initial fetch only
 *   error     — last fetch error, or null
 *   refetch   — manually trigger a reload
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/platform/supabase/client';
import type { PlanningRequest, PlanningOffer } from '../types';

// Cast to `any` because planning_requests / planning_offers are not in the
// generated Supabase Database type definitions yet.
const db = supabase as any;

const POLL_INTERVAL_MS = 10_000;

export interface UsePlanningRequestResult {
  request: PlanningRequest | null;
  offers: PlanningOffer[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function usePlanningRequest(
  requestId: string | null,
): UsePlanningRequestResult {
  const [request, setRequest] = useState<PlanningRequest | null>(null);
  const [offers, setOffers] = useState<PlanningOffer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Track whether the component is still mounted to guard async state sets
  const mountedRef = useRef(true);
  // Hold the fetch counter so in-flight fetches from a previous requestId
  // are silently discarded when requestId changes mid-flight.
  const fetchCounterRef = useRef(0);
  // Polling fallback timer
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(
    async (expectedCounter: number): Promise<void> => {
      if (!requestId) return;

      const [requestRes, offersRes] = await Promise.all([
        db
          .from('planning_requests')
          .select('*')
          .eq('id', requestId)
          .single(),
        db
          .from('planning_offers')
          .select('*')
          .eq('request_id', requestId)
          .order('created_at', { ascending: true }),
      ]);

      // Discard results if the component unmounted or the requestId changed
      if (!mountedRef.current || fetchCounterRef.current !== expectedCounter) {
        return;
      }

      if (requestRes.error) {
        const err = new Error(requestRes.error.message ?? 'Failed to fetch planning request');
        setError(err);
        setIsLoading(false);
        return;
      }

      if (offersRes.error) {
        const err = new Error(offersRes.error.message ?? 'Failed to fetch planning offers');
        setError(err);
        setIsLoading(false);
        return;
      }

      setRequest(requestRes.data as PlanningRequest);
      setOffers((offersRes.data ?? []) as PlanningOffer[]);
      setError(null);
      setIsLoading(false);
    },
    [requestId],
  );

  const refetch = useCallback((): void => {
    const counter = ++fetchCounterRef.current;
    fetchData(counter);
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;

    if (!requestId) {
      setRequest(null);
      setOffers([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Initial load
    setIsLoading(true);
    setError(null);
    const counter = ++fetchCounterRef.current;
    fetchData(counter);

    // Realtime subscription — listen for changes on planning_requests and
    // planning_offers that concern this specific request.
    const channelName = `planning-request-${requestId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'planning_requests',
          filter: `id=eq.${requestId}`,
        },
        () => {
          if (mountedRef.current) {
            const c = ++fetchCounterRef.current;
            fetchData(c);
          }
        },
      )
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'planning_offers',
          filter: `request_id=eq.${requestId}`,
        },
        () => {
          if (mountedRef.current) {
            const c = ++fetchCounterRef.current;
            fetchData(c);
          }
        },
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Realtime failed — fall back to polling
          if (!pollTimerRef.current) {
            pollTimerRef.current = setInterval(() => {
              if (mountedRef.current) {
                const c = ++fetchCounterRef.current;
                fetchData(c);
              }
            }, POLL_INTERVAL_MS);
          }
        } else if (status === 'SUBSCRIBED') {
          // Realtime is healthy — cancel any polling fallback
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      });

    return () => {
      mountedRef.current = false;
      fetchCounterRef.current++;   // invalidate any in-flight fetch
      supabase.removeChannel(channel);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [requestId, fetchData]);

  return { request, offers, isLoading, error, refetch };
}
