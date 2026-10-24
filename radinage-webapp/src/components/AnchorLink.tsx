import { Anchor, type AnchorProps } from "@mantine/core";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, Ref } from "react";

type MantineAnchorProps = Omit<AnchorProps, "href"> &
	Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "color" | "style"> & {
		ref?: Ref<HTMLAnchorElement>;
	};

function MantineAnchor(props: MantineAnchorProps) {
	return <Anchor {...props} />;
}

const CreatedAnchorLink = createLink(MantineAnchor);

/** A Mantine anchor whose `to`, `params` and `search` are checked against the routes. */
export const AnchorLink: LinkComponent<typeof MantineAnchor> = (props) => (
	<CreatedAnchorLink {...props} />
);
