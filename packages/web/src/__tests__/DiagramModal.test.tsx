import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DiagramModal } from "../components/DiagramModal";

describe("DiagramModal", () => {
  it("renders zoom modal when open is true", () => {
    render(
      <DiagramModal
        open={true}
        onClose={vi.fn()}
        title="架构原理图"
        code="graph TD; A-->B;"
      />,
    );

    expect(screen.getByText("架构原理图")).toBeInTheDocument();
    expect(screen.getByText("graph TD; A-->B;")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("handles zoom in and zoom out buttons", () => {
    render(
      <DiagramModal
        open={true}
        onClose={vi.fn()}
        code="graph TD; A-->B;"
      />,
    );

    const zoomInBtn = screen.getByText("+");
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("130%")).toBeInTheDocument();

    const zoomOutBtn = screen.getByText("-");
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
