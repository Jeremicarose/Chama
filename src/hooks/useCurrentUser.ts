'use client';

import { useState, useEffect } from 'react';
import { fcl } from '@/lib/flow-config';

export interface FlowUser {
  addr: string | null;
  loggedIn: boolean;
  cid: string | null;
}

const DEFAULT_USER: FlowUser = { addr: null, loggedIn: false, cid: null };

export function useCurrentUser() {
  const [user, setUser] = useState<FlowUser>(DEFAULT_USER);

  useEffect(() => {
    // fcl.currentUser.subscribe fires immediately with the current state,
    // then again whenever the user logs in/out.
    const unsubscribe = fcl.currentUser.subscribe((snapshot: FlowUser) => {
      setUser(snapshot ?? DEFAULT_USER);
    });
    return () => unsubscribe();
  }, []);

  const logIn = () => fcl.authenticate();
  const logOut = () => fcl.unauthenticate();

  return { user, logIn, logOut };
}
