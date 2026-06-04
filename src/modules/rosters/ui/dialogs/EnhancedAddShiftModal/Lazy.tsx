import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { EnhancedAddShiftModalProps } from './types';

// Lazy-load the heavy modal chunk
const EnhancedAddShiftModal = lazy(() => import('./index'));

/**
 * A wrapper for EnhancedAddShiftModal that lazy-loads the actual modal
 * only when it's first opened, reducing the initial JS bundle size.
 * It remains mounted after the first open so the Sheet exit animation can play.
 */
export const LazyEnhancedAddShiftModal: React.FC<EnhancedAddShiftModalProps> = (props) => {
    const [hasOpened, setHasOpened] = useState(false);

    useEffect(() => {
        if (props.isOpen) {
            setHasOpened(true);
        }
    }, [props.isOpen]);

    // Don't render anything (not even Suspense) until the modal is triggered
    if (!hasOpened) return null;

    return (
        <Suspense fallback={null}>
            <EnhancedAddShiftModal {...props} />
        </Suspense>
    );
};
