import React, { createContext, useContext, useState } from 'react';

interface SearchContextType {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searchResults: any[];
  performSearch: (term: string) => void;
  isSearching: boolean;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const performSearch = async (term: string) => {
    setIsSearching(true);
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock search results based on the current route
    const path = window.location.pathname;
    let results: any[] = [];

    if (path.includes('templates')) {
      results = mockTemplateSearch(term);
    } else if (path.includes('rosters')) {
      results = mockRosterSearch(term);
    } else if (path.includes('timesheets')) {
      results = mockTimesheetSearch(term);
    } else if (path.includes('bids')) {
      results = mockBidSearch(term);
    }

    setSearchResults(results);
    setIsSearching(false);
  };

  return (
    <SearchContext.Provider value={{
      searchTerm,
      setSearchTerm,
      searchResults,
      performSearch,
      isSearching
    }}>
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
};

// Mock search functions
const mockTemplateSearch = (term: string) => {
  const templates = [
    { id: 1, name: 'Standard Weekday Template', type: 'template' },
    { id: 2, name: 'Weekend Template', type: 'template' },
    { id: 3, name: 'Special Event Template', type: 'template' }
  ];
  return templates.filter(t => t.name.toLowerCase().includes(term.toLowerCase()));
};

const mockRosterSearch = (term: string) => {
  const rosters = [
    { id: 1, name: 'Morning Shift', department: 'Convention', type: 'roster' },
    { id: 2, name: 'Evening Shift', department: 'Exhibition', type: 'roster' },
    { id: 3, name: 'Night Shift', department: 'Theatre', type: 'roster' }
  ];
  return rosters.filter(r => 
    r.name.toLowerCase().includes(term.toLowerCase()) ||
    r.department.toLowerCase().includes(term.toLowerCase())
  );
};

const mockTimesheetSearch = (term: string) => {
  const timesheets = [
    { id: 1, employee: 'John Smith', date: '2024-03-15', type: 'timesheet' },
    { id: 2, employee: 'Emma Watson', date: '2024-03-14', type: 'timesheet' },
    { id: 3, employee: 'David Miller', date: '2024-03-13', type: 'timesheet' }
  ];
  return timesheets.filter(t => 
    t.employee.toLowerCase().includes(term.toLowerCase()) ||
    t.date.includes(term)
  );
};

const mockBidSearch = (term: string) => {
  const bids = [
    { id: 1, employee: 'Sarah Johnson', shift: 'Morning Shift', type: 'bid' },
    { id: 2, employee: 'Michael Chen', shift: 'Evening Shift', type: 'bid' },
    { id: 3, employee: 'Lisa Brown', shift: 'Night Shift', type: 'bid' }
  ];
  return bids.filter(b => 
    b.employee.toLowerCase().includes(term.toLowerCase()) ||
    b.shift.toLowerCase().includes(term.toLowerCase())
  );
};
