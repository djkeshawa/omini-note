const { useCallback, useRef, useState } = React;

export function useNavigationController({ defaultSmartViews }) {
  const [selectedTag, setSelectedTag] = useState(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [view, setView] = useState('notes');
  const [savedSmartViews, setSavedSmartViews] = useState(defaultSmartViews);
  const [activeSmartViewId, setActiveSmartViewId] = useState('');
  const [graphFilter, setGraphFilter] = useState('all-novelist');
  const [query, setQuery] = useState('');
  const lastViewRef = useRef('notes');

  const navigateView = useCallback((nextView) => {
    setView(current => {
      if (current !== nextView) lastViewRef.current = current;
      return nextView;
    });
  }, []);

  const openSmartView = useCallback((definitionId = '') => {
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    setActiveSmartViewId(String(definitionId || ''));
    navigateView('smart-views');
    return { message: 'Opened Smart Views.' };
  }, [navigateView]);

  const goBackView = useCallback(() => {
    const target = lastViewRef.current || 'notes';
    setView(current => {
      lastViewRef.current = current === target ? 'notes' : current;
      return target;
    });
  }, []);

  return {
    selectedTag,
    setSelectedTag,
    selectedWorkflow,
    setSelectedWorkflow,
    view,
    setView,
    savedSmartViews,
    setSavedSmartViews,
    activeSmartViewId,
    setActiveSmartViewId,
    graphFilter,
    setGraphFilter,
    query,
    setQuery,
    navigateView,
    openSmartView,
    goBackView,
  };
}
